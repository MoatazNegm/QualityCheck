const express = require('express');
const router = express.Router();
const { testsDb, cache } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const dropboxService = require('../dropbox/dropboxService');

// Get all system settings
router.get('/', authenticateToken, async (req, res) => {
  try {
    const cached = cache.get('settings');
    let settingsMap = {};

    if (cached) {
      settingsMap = { ...cached };
    } else {
      const rows = await testsDb.prepare('SELECT key, value, description, updated_at FROM settings').all();
      for (const r of rows) {
        settingsMap[r.key] = {
          value: r.value,
          description: r.description,
          updated_at: r.updated_at
        };
      }
      cache.set('settings', settingsMap);
    }

    // Format response: provide safe summary for sensitive Dropbox credentials
    const safeResponse = {};
    for (const [k, v] of Object.entries(settingsMap)) {
      if (k === 'dropbox_app_secret' || k === 'dropbox_refresh_token') {
        const isConfigured = !!(v && v.value && v.value.trim().length > 0);
        safeResponse[k] = {
          value: isConfigured ? '__CONFIGURED__' : '',
          isConfigured,
          description: v.description,
          updated_at: v.updated_at
        };
      } else {
        safeResponse[k] = v;
      }
    }

    res.json(safeResponse);
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

    let valStr = String(value).trim();
    if (key === 'consecutive_failure_threshold_seconds') {
      const num = parseInt(valStr, 10);
      if (isNaN(num) || num < 0) {
        return res.status(400).json({ error: 'Threshold must be a non-negative number of seconds' });
      }
    }

    if (key === 'dropbox_app_secret' || key === 'dropbox_refresh_token') {
      if (valStr === '__KEEP_EXISTING__' || valStr === '__CONFIGURED__') {
        return res.json({ message: 'Existing Dropbox credentials retained' });
      }
    }

    await testsDb.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
    `).run(key, valStr, valStr);

    cache.invalidate('settings');
    res.json({ message: 'Setting updated successfully', key });
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Exchange Dropbox OAuth code for refresh token
router.post('/dropbox-auth', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri are required' });

    const appKeyRow = await testsDb.prepare("SELECT value FROM settings WHERE key = 'dropbox_app_key'").get();
    const appSecretRow = await testsDb.prepare("SELECT value FROM settings WHERE key = 'dropbox_app_secret'").get();
    
    if (!appKeyRow?.value || !appSecretRow?.value) {
      return res.status(400).json({ error: 'Dropbox App Key and Secret must be saved first.' });
    }

    const refreshToken = await dropboxService.exchangeCodeForRefreshToken(appKeyRow.value, appSecretRow.value, code, redirectUri);
    
    await testsDb.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
    `).run('dropbox_refresh_token', refreshToken, refreshToken);
    
    cache.invalidate('settings');
    res.json({ message: 'Dropbox connected successfully' });
  } catch (error) {
    console.error('Dropbox auth error:', error);
    res.status(400).json({ error: error.message || 'Failed to authenticate with Dropbox' });
  }
});

// Test Dropbox connection in real-time (Admin only)
router.post('/test-dropbox', authenticateToken, requireAdmin, async (req, res) => {
  try {
    let { appKey, appSecret, refreshToken } = req.body || {};

    if (!appKey || !appKey.trim()) {
      const saved = await testsDb.prepare("SELECT value FROM settings WHERE key = 'dropbox_app_key'").get();
      appKey = saved?.value;
    }
    if (!appSecret || appSecret.includes('●') || appSecret === '__KEEP_EXISTING__' || appSecret === '__CONFIGURED__') {
      const saved = await testsDb.prepare("SELECT value FROM settings WHERE key = 'dropbox_app_secret'").get();
      appSecret = saved?.value;
    }
    if (!refreshToken || refreshToken.includes('●') || refreshToken === '__KEEP_EXISTING__' || refreshToken === '__CONFIGURED__') {
      const saved = await testsDb.prepare("SELECT value FROM settings WHERE key = 'dropbox_refresh_token'").get();
      refreshToken = saved?.value;
    }

    if (!appKey || !appSecret || !refreshToken) {
      return res.status(400).json({ error: 'Missing Dropbox credentials. Please connect and authorize Dropbox first.' });
    }

    const testResult = await dropboxService.testDropboxConnection(appKey, appSecret, refreshToken);
    res.json({ success: true, account: testResult.name ? testResult.name.display_name : testResult.email });
  } catch (error) {
    console.error('Test Dropbox error:', error);
    res.status(400).json({ error: error.message || 'Failed to connect to Dropbox' });
  }
});

module.exports = router;
