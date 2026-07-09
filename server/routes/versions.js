const express = require('express');
const router = express.Router();
const { testsDb } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Returns the currently active version (the one users should run tests for).
// Returns { version: <row> | null }.
router.get('/current', authenticateToken, (req, res) => {
  try {
    const version = testsDb.prepare('SELECT * FROM versions WHERE is_current = 1 LIMIT 1').get();
    res.json({ version: version || null });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// List all versions (admin only). Current one is flagged.
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const versions = testsDb.prepare('SELECT * FROM versions ORDER BY created_at DESC, id DESC').all();
    res.json(versions);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new version (admin only). The first created version becomes current
// automatically if none is set yet.
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, note } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Version name is required' });
    }

    const hasCurrent = testsDb.prepare('SELECT 1 FROM versions WHERE is_current = 1 LIMIT 1').get();
    const result = testsDb.prepare(
      'INSERT INTO versions (name, note, is_current) VALUES (?, ?, ?)'
    ).run(String(name).trim(), note || null, hasCurrent ? 0 : 1);

    const version = testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(result.lastInsertRowid);
    res.json({ version, message: hasCurrent ? 'Version created' : 'Version created and set as current' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Set a version as the current one (admin only). Unsets any previously current version.
router.post('/:id/set-current', authenticateToken, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const version = testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const tx = testsDb.transaction(() => {
      testsDb.prepare('UPDATE versions SET is_current = 0').run();
      testsDb.prepare('UPDATE versions SET is_current = 1 WHERE id = ?').run(id);
    });
    tx();

    const updated = testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    res.json({ version: updated, message: 'Current version updated' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a version (admin only). Blocked while it still has recorded results or
// points, to avoid orphaning per-version history.
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const version = testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const used = testsDb.prepare(
      'SELECT 1 FROM test_results WHERE version_id = ? LIMIT 1'
    ).get(id) || testsDb.prepare('SELECT 1 FROM points_log WHERE version_id = ? LIMIT 1').get(id);
    if (used) {
      return res.status(400).json({ error: 'Cannot delete a version that has logged results' });
    }

    testsDb.prepare('DELETE FROM versions WHERE id = ?').run(id);
    res.json({ message: 'Version deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
