const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { usersDb, testsDb } = require('../db/db');

// Get all users (admin only)
router.get('/', async (req, res) => {
  try {
    const users = await usersDb.prepare(
      'SELECT id, username, is_admin FROM users'
    ).all();
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get test summary for a user (admin only)
router.get('/:id/test-summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const assigned = await testsDb.prepare(
      'SELECT test_id FROM test_assignments WHERE user_id = ?'
    ).all(userId);

    const assignedCount = assigned.length;
    let completedCount = 0;
    let failedHardStopCount = 0;

    for (const row of assigned) {
      const testId = row.test_id;
      const stepCountRow = await testsDb.prepare(
        'SELECT COUNT(*) as c FROM test_steps WHERE test_id = ?'
      ).get(testId);
      const doneCountRow = await testsDb.prepare(
        'SELECT COUNT(*) as c FROM test_results WHERE user_id = ? AND test_id = ?'
      ).get(userId, testId);

      if (doneCountRow.c >= stepCountRow.c) {
        completedCount++;
      } else {
        const failRow = await testsDb.prepare(`
          SELECT COUNT(*) as c FROM test_submissions ts
          JOIN test_steps tstep ON ts.step_id = tstep.id
          WHERE ts.user_id = ? AND ts.test_id = ? AND ts.result = 'fail' AND tstep.on_failure = 'stop'
        `).get(userId, testId);

        if (failRow.c > 0) {
          failedHardStopCount++;
        }
      }
    }

    res.json({ assignedCount, completedCount, failedHardStopCount });
  } catch (error) {
    console.error('Get user test summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (admin only)
router.post('/', async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await usersDb.prepare(`
      INSERT INTO users (username, password_hash, is_admin)
      VALUES (?, ?, ?)
    `).run(username, hashedPassword, isAdmin ? 1 : 0);

    const newUserId = result.lastInsertRowid;

    // Auto-assign all existing tests to the new non-admin user
    if (!isAdmin) {
      const allTests = await testsDb.prepare('SELECT id FROM tests').all();
      const batch = allTests.map(test => ({
        sql: 'INSERT OR IGNORE INTO test_assignments (test_id, user_id) VALUES (?, ?)',
        args: [test.id, newUserId]
      }));
      await testsDb.client.batch(batch, 'write');
    }

    res.json({ id: newUserId, username, is_admin: isAdmin ? 1 : 0 });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

const fs = require('fs');
const path = require('path');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { dataDir } = require('../utils/dataDir');

const uploadDir = path.join(dataDir, 'uploads');

// Delete user (admin only) — cascades every piece of data tied to the user so it
// is as if they were never added: their results, assignments, loop state, points
// ledger, sessions, the user row itself, and every uploaded config file they
// submitted (so the failure attachments are removed too).
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await usersDb.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Capture the uploaded files this user submitted before deleting the rows.
    const fileRows = await testsDb.prepare(
      'SELECT DISTINCT config_file_path FROM test_results WHERE user_id = ? AND config_file_path IS NOT NULL'
    ).all(userId);
    const filesToDelete = fileRows
      .map(r => r.config_file_path)
      .filter(Boolean)
      .map(p => path.basename(p));

    // Cascade delete in a transaction batch.
    await testsDb.client.batch([
      { sql: 'DELETE FROM user_sessions WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM test_results WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM test_submissions WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM points_log WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM test_assignments WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM user_loop_state WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM user_test_rounds WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM users WHERE id = ?', args: [userId] }
    ], 'write');

    // Remove the user's uploaded files from disk.
    let deletedFiles = 0;
    for (const fileName of filesToDelete) {
      const absPath = path.join(uploadDir, fileName);
      if (fs.existsSync(absPath)) {
        try {
          fs.unlinkSync(absPath);
          deletedFiles++;
        } catch (e) {
          console.error('Failed to delete upload file', fileName, e);
        }
      }
    }

    res.json({ message: 'User and all associated data deleted successfully', deletedFiles });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user role (admin only)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_admin } = req.body;
    
    await usersDb.prepare(
      'UPDATE users SET is_admin = ? WHERE id = ?'
    ).run(is_admin ? 1 : 0, id);
    
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change user password (admin only)
router.put('/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    
    if (!password || password.trim().length === 0) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    const hashedPassword = await bcrypt.hash(password.trim(), 10);
    
    await usersDb.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).run(hashedPassword, id);
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;