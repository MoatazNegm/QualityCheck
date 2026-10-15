const express = require('express');
const router = express.Router();
const { testsDb, cache } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { getAppId, canUserAccessApp, isGlobalAdminUser, getUserAssignedApps } = require('../utils/appContext');

// Returns the currently active version for an app (the one users should run tests for).
// Returns { version: <row> | null }.
router.get('/current', authenticateToken, async (req, res) => {
  try {
    const appId = getAppId(req);
    const cleanAppId = appId === 'all' ? (getUserAssignedApps(req.user)[0] || 1) : appId;

    if (!canUserAccessApp(req.user, cleanAppId)) {
      return res.status(403).json({ error: 'You do not have access to this application' });
    }

    let version = null;
    const cacheKey = `currentVersionId:${cleanAppId}`;
    const cachedId = cache.get(cacheKey);

    if (cachedId) {
      version = await testsDb.prepare('SELECT * FROM versions WHERE id = ? AND app_id = ?').get(cachedId, cleanAppId);
    } else {
      version = await testsDb.prepare('SELECT * FROM versions WHERE is_current = 1 AND app_id = ? LIMIT 1').get(cleanAppId);
      if (!version) {
        version = await testsDb.prepare('SELECT * FROM versions WHERE app_id = ? ORDER BY id DESC LIMIT 1').get(cleanAppId);
      }
      if (version) {
        cache.set(cacheKey, version.id);
      }
    }
    res.json({ version: version || null });
  } catch (error) {
    console.error('Get current version error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// List all versions for an app (authenticated users). Current one is flagged.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const appId = getAppId(req);
    let versions;
    if (appId === 'all') {
      if (isGlobalAdminUser(req.user)) {
        versions = await testsDb.prepare('SELECT * FROM versions ORDER BY created_at DESC, id DESC').all();
      } else {
        const userAssigned = getUserAssignedApps(req.user);
        if (userAssigned.length === 0) {
          versions = [];
        } else {
          const placeholders = userAssigned.map(() => '?').join(',');
          versions = await testsDb.prepare(`SELECT * FROM versions WHERE app_id IN (${placeholders}) ORDER BY created_at DESC, id DESC`).all(...userAssigned);
        }
      }
    } else {
      if (!canUserAccessApp(req.user, appId)) {
        return res.status(403).json({ error: 'You do not have access to this application' });
      }
      versions = await testsDb.prepare('SELECT * FROM versions WHERE app_id = ? ORDER BY created_at DESC, id DESC').all(appId);
    }
    res.json(versions);
  } catch (error) {
    console.error('List versions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new version for an app (admin only). The first created version becomes current
// automatically if none is set yet.
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const appId = getAppId(req);
    if (appId === 'all' || !canUserAccessApp(req.user, appId)) {
      return res.status(403).json({ error: 'You do not have permission to create versions for this application' });
    }

    const { name, note } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Version name is required' });
    }

    const hasCurrent = await testsDb.prepare('SELECT 1 FROM versions WHERE is_current = 1 AND app_id = ? LIMIT 1').get(appId);
    const result = await testsDb.prepare(
      'INSERT INTO versions (name, note, is_current, app_id) VALUES (?, ?, ?, ?)'
    ).run(String(name).trim(), note || null, hasCurrent ? 0 : 1, appId);

    const version = await testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(result.lastInsertRowid);
    cache.invalidate(`currentVersionId:${appId}`);
    cache.invalidate('currentVersionId');
    res.json({ version, message: hasCurrent ? 'Version created' : 'Version created and set as current' });
  } catch (error) {
    console.error('Create version error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Set a version as the current one for an app (admin only). Unsets any previously current version for that app.
router.post('/:id/set-current', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const version = await testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const appId = version.app_id || 1;
    if (!canUserAccessApp(req.user, appId)) {
      return res.status(403).json({ error: 'You do not have permission to modify versions for this application' });
    }

    await testsDb.client.batch([
      { sql: 'UPDATE versions SET is_current = 0 WHERE app_id = ?', args: [appId] },
      { sql: 'UPDATE versions SET is_current = 1 WHERE id = ? AND app_id = ?', args: [id, appId] }
    ], 'write');

    const updated = await testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    cache.invalidate(`currentVersionId:${appId}`);
    cache.invalidate('currentVersionId');
    res.json({ version: updated, message: 'Current version updated' });
  } catch (error) {
    console.error('Set current version error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a version (admin only). Blocked while it still has recorded results or
// points, to avoid orphaning per-version history.
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const version = await testsDb.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const appId = version.app_id || 1;
    const used = (await testsDb.prepare('SELECT 1 FROM test_results WHERE version_id = ? LIMIT 1').get(id)) ||
                 (await testsDb.prepare('SELECT 1 FROM points_log WHERE version_id = ? LIMIT 1').get(id));
    if (used) {
      return res.status(400).json({ error: 'Cannot delete a version that has logged results' });
    }

    await testsDb.prepare('DELETE FROM versions WHERE id = ?').run(id);
    cache.invalidate(`currentVersionId:${appId}`);
    cache.invalidate('currentVersionId');
    res.json({ message: 'Version deleted' });
  } catch (error) {
    console.error('Delete version error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
