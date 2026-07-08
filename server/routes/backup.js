const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { usersDb, testsDb } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

router.get('/export', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = usersDb.prepare('SELECT id, username, is_admin FROM users').all();
    const tests = testsDb.prepare('SELECT * FROM tests').all();
    const testSteps = testsDb.prepare('SELECT * FROM test_steps').all();
    const testResults = testsDb.prepare('SELECT * FROM test_results').all();
    const testAssignments = testsDb.prepare('SELECT * FROM test_assignments').all();
    const userLoopState = testsDb.prepare('SELECT * FROM user_loop_state').all();

    const backup = {
      metadata: {
        exportedAt: new Date().toISOString(),
        app: 'QualityCheck',
      },
      users,
      tests,
      test_steps: testSteps,
      test_results: testResults,
      test_assignments: testAssignments,
      user_loop_state: userLoopState,
    };

    const filename = `qualitycheck-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    console.error('Backup export error:', error);
    res.status(500).json({ error: 'Failed to export backup' });
  }
});

router.post('/import', authenticateToken, requireAdmin, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const backup = JSON.parse(req.file.buffer.toString('utf-8'));

    if (!backup || !Array.isArray(backup.users) || !Array.isArray(backup.tests)) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    usersDb.prepare('DELETE FROM user_sessions').run();
    usersDb.prepare('DELETE FROM users').run();

    testsDb.prepare('DELETE FROM test_results').run();
    testsDb.prepare('DELETE FROM test_assignments').run();
    testsDb.prepare('DELETE FROM user_loop_state').run();
    testsDb.prepare('DELETE FROM test_steps').run();
    testsDb.prepare('DELETE FROM tests').run();

    const insertUser = usersDb.prepare(`
      INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)
    `);

    for (const user of backup.users) {
      const passwordHash = user.password_hash || bcrypt.hashSync('changeme', 10);
      insertUser.run(user.id, user.username, passwordHash, user.is_admin ? 1 : 0);
    }

    const insertTest = testsDb.prepare('INSERT INTO tests (id, name, description) VALUES (?, ?, ?)');
    const insertStep = testsDb.prepare(`
      INSERT INTO test_steps (id, test_id, step_number, description, success_symptom, value, on_failure)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertResult = testsDb.prepare(`
      INSERT INTO test_results (id, user_id, test_id, step_id, result, comment, config_file_path, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAssignment = testsDb.prepare(`
      INSERT INTO test_assignments (id, test_id, user_id, assigned_at) VALUES (?, ?, ?, ?)
    `);
    const insertLoopState = testsDb.prepare(`
      INSERT INTO user_loop_state (user_id, active_test_id) VALUES (?, ?)
    `);

    for (const test of backup.tests) {
      insertTest.run(test.id, test.name, test.description);
    }

    for (const step of backup.test_steps || []) {
      insertStep.run(step.id, step.test_id, step.step_number, step.description, step.success_symptom, step.value, step.on_failure);
    }

    for (const result of backup.test_results || []) {
      insertResult.run(
        result.id,
        result.user_id,
        result.test_id,
        result.step_id,
        result.result,
        result.comment,
        result.config_file_path,
        result.executed_at
      );
    }

    for (const assignment of backup.test_assignments || []) {
      insertAssignment.run(assignment.id, assignment.test_id, assignment.user_id, assignment.assigned_at);
    }

    for (const loop of backup.user_loop_state || []) {
      insertLoopState.run(loop.user_id, loop.active_test_id);
    }

    res.json({ message: 'Restore completed successfully' });
  } catch (error) {
    console.error('Backup import error:', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

module.exports = router;
