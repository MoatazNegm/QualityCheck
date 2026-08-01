const express = require('express');
const router = express.Router();
const { testsDb } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Get all system settings
router.get('/', authenticateToken, async (req, res) => {
  try {
    const rows = await testsDb.prepare('SELECT key, value, description, updated_at FROM settings').all();
    const settingsMap = {};
    for (const r of rows) {
      settingsMap[r.key] = {
        value: r.value,
        description: r.description,
        updated_at: r.updated_at
      };
    }
    res.json(settingsMap);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a setting (Admin only)
router.put('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined || value === null) {
      return res.status(400).json({ error: 'key and value are required' });
    }

    const valStr = String(value).trim();
    if (key === 'consecutive_failure_threshold_seconds') {
      const num = parseInt(valStr, 10);
      if (isNaN(num) || num < 0) {
        return res.status(400).json({ error: 'Threshold must be a non-negative number of seconds' });
      }
    }

    await testsDb.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
    `).run(key, valStr, valStr);

    res.json({ message: 'Setting updated successfully', key, value: valStr });
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
