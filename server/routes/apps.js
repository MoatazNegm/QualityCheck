const express = require('express');
const router = express.Router();
const { testsDb, usersDb, cache } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Helper to determine if user has admin privileges
function isAdminUser(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const groups = user.userGroups || [];
  return groups.includes('admins');
}

// List active apps: admins see all non-deleted apps, non-admins see non-deleted apps assigned to them
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = isAdminUser(req.user);
    const includeArchived = req.query.includeArchived === 'true' || req.query.archived === 'true';

    if (isAdmin) {
      const sql = includeArchived
        ? `SELECT id, name, description, created_at,
                  COALESCE(is_suspended, 0) as is_suspended,
                  COALESCE(is_deleted, 0) as is_deleted,
                  suspended_at, deleted_at
           FROM apps ORDER BY id`
        : `SELECT id, name, description, created_at,
                  COALESCE(is_suspended, 0) as is_suspended,
                  COALESCE(is_deleted, 0) as is_deleted,
                  suspended_at, deleted_at
           FROM apps
           WHERE COALESCE(is_deleted, 0) = 0
           ORDER BY id`;
      const apps = await testsDb.prepare(sql).all();
      return res.json(apps);
    }

    const userId = req.user.userId;
    const apps = await testsDb.prepare(`
      SELECT a.id, a.name, a.description, a.created_at,
             COALESCE(a.is_suspended, 0) as is_suspended,
             COALESCE(a.is_deleted, 0) as is_deleted,
             a.suspended_at, a.deleted_at
      FROM apps a
      JOIN user_apps ua ON a.id = ua.app_id
      WHERE ua.user_id = ? AND COALESCE(a.is_deleted, 0) = 0
      ORDER BY a.id
    `).all(userId);

    if (apps.length === 0) {
      const defaultApp = await testsDb.prepare(`
        SELECT id, name, description, created_at,
               COALESCE(is_suspended, 0) as is_suspended,
               COALESCE(is_deleted, 0) as is_deleted,
               suspended_at, deleted_at
        FROM apps WHERE id = 1 AND COALESCE(is_deleted, 0) = 0
      `).get();
      if (defaultApp) apps.push(defaultApp);
    }

    res.json(apps);
  } catch (error) {
    console.error('Get apps error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// List archived/deleted apps (Admin only - for Archive Settings)
router.get('/archived', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const archivedApps = await testsDb.prepare(`
      SELECT id, name, description, created_at, deleted_at,
             COALESCE(is_suspended, 0) as is_suspended,
             1 as is_deleted
      FROM apps
      WHERE COALESCE(is_deleted, 0) = 1
      ORDER BY deleted_at DESC, id DESC
    `).all();

    res.json(archivedApps);
  } catch (error) {
    console.error('Get archived apps error:', error);
    res.status(500).json({ error: 'Server error fetching archived apps' });
  }
});

// Get a single app by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const app = await testsDb.prepare(`
      SELECT id, name, description, created_at,
             COALESCE(is_suspended, 0) as is_suspended,
             COALESCE(is_deleted, 0) as is_deleted,
             suspended_at, deleted_at
      FROM apps WHERE id = ?
    `).get(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    res.json(app);
  } catch (error) {
    console.error('Get app error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get stats for an app (for Admin overview cards)
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const app = await testsDb.prepare(`
      SELECT id, name, description, created_at,
             COALESCE(is_suspended, 0) as is_suspended,
             COALESCE(is_deleted, 0) as is_deleted
      FROM apps WHERE id = ?
    `).get(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const testCountRow = await testsDb.prepare(
      'SELECT COUNT(*) as c FROM tests WHERE app_id = ? AND COALESCE(is_deleted, 0) = 0'
    ).get(id);

    const versionCountRow = await testsDb.prepare(
      'SELECT COUNT(*) as c FROM versions WHERE app_id = ?'
    ).get(id);

    const currentVersionRow = await testsDb.prepare(
      'SELECT name FROM versions WHERE app_id = ? AND is_current = 1 LIMIT 1'
    ).get(id);

    const userCountRow = await testsDb.prepare(
      'SELECT COUNT(DISTINCT user_id) as c FROM user_apps WHERE app_id = ?'
    ).get(id);

    const execCountRow = await testsDb.prepare(
      'SELECT COUNT(*) as c FROM test_results WHERE app_id = ?'
    ).get(id);

    res.json({
      id: app.id,
      name: app.name,
      description: app.description,
      is_suspended: !!app.is_suspended,
      is_deleted: !!app.is_deleted,
      testsCount: testCountRow ? testCountRow.c : 0,
      versionsCount: versionCountRow ? versionCountRow.c : 0,
      currentVersion: currentVersionRow ? currentVersionRow.name : 'None',
      usersCount: userCountRow ? userCountRow.c : 0,
      executionsCount: execCountRow ? execCountRow.c : 0
    });
  } catch (error) {
    console.error('Get app stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new App (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'App name is required' });
    }

    const cleanName = String(name).trim();
    const existing = await testsDb.prepare('SELECT id, is_deleted FROM apps WHERE LOWER(name) = LOWER(?)').get(cleanName);
    if (existing) {
      if (existing.is_deleted) {
        return res.status(400).json({ error: `An app named "${cleanName}" exists in the Archive. You can restore it from Archive Settings.` });
      }
      return res.status(400).json({ error: `An app with name "${cleanName}" already exists` });
    }

    const result = await testsDb.prepare(
      'INSERT INTO apps (name, description, is_suspended, is_deleted) VALUES (?, ?, 0, 0)'
    ).run(cleanName, description ? String(description).trim() : null);

    const newAppId = result.lastInsertRowid;
    const newApp = await testsDb.prepare(`
      SELECT id, name, description, created_at,
             COALESCE(is_suspended, 0) as is_suspended,
             COALESCE(is_deleted, 0) as is_deleted
      FROM apps WHERE id = ?
    `).get(newAppId);

    // Automatically assign admin to the new app
    if (req.user && req.user.userId) {
      await testsDb.prepare('INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)').run(req.user.userId, newAppId);
    }

    cache.clear();
    res.status(201).json(newApp);
  } catch (error) {
    console.error('Create app error:', error);
    res.status(500).json({ error: 'Server error creating app' });
  }
});

// Update an App (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, description } = req.body;

    const app = await testsDb.prepare('SELECT id, name FROM apps WHERE id = ?').get(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const cleanName = name ? String(name).trim() : app.name;
    const cleanDesc = description !== undefined ? (description ? String(description).trim() : null) : null;

    if (!cleanName) {
      return res.status(400).json({ error: 'App name cannot be empty' });
    }

    // Check for duplicate name
    const dup = await testsDb.prepare('SELECT id FROM apps WHERE LOWER(name) = LOWER(?) AND id != ?').get(cleanName, id);
    if (dup) {
      return res.status(400).json({ error: `Another app already has the name "${cleanName}"` });
    }

    await testsDb.prepare(
      'UPDATE apps SET name = ?, description = ? WHERE id = ?'
    ).run(cleanName, cleanDesc, id);

    const updated = await testsDb.prepare(`
      SELECT id, name, description, created_at,
             COALESCE(is_suspended, 0) as is_suspended,
             COALESCE(is_deleted, 0) as is_deleted
      FROM apps WHERE id = ?
    `).get(id);

    cache.clear();
    res.json(updated);
  } catch (error) {
    console.error('Update app error:', error);
    res.status(500).json({ error: 'Server error updating app' });
  }
});

// Suspend or Unsuspend an App (admin only)
// Suspended apps appear in the left pane and in global reports, but users cannot logon to use them
router.patch('/:id/suspend', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const app = await testsDb.prepare('SELECT id, name, is_suspended FROM apps WHERE id = ?').get(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Determine target suspended state
    let targetSuspended;
    if (req.body && typeof req.body.suspend === 'boolean') {
      targetSuspended = req.body.suspend ? 1 : 0;
    } else {
      targetSuspended = app.is_suspended ? 0 : 1;
    }

    if (targetSuspended === 1) {
      await testsDb.prepare(`
        UPDATE apps SET is_suspended = 1, suspended_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(id);
    } else {
      await testsDb.prepare(`
        UPDATE apps SET is_suspended = 0, suspended_at = NULL WHERE id = ?
      `).run(id);
    }

    cache.clear();

    res.json({
      message: targetSuspended === 1
        ? `Application "${app.name}" has been suspended. Non-admin users will not be able to log in to this app.`
        : `Application "${app.name}" has been resumed. User access restored.`,
      id,
      is_suspended: targetSuspended === 1
    });
  } catch (error) {
    console.error('Suspend app error:', error);
    res.status(500).json({ error: 'Server error updating app suspension state' });
  }
});

// Soft-Delete (Archive) an App (admin only)
// Preserves all database rows (tests, submissions, points, users) but excludes app from active logon/sidebar and normal reports
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const activeAppsCount = await testsDb.prepare(
      'SELECT COUNT(*) as c FROM apps WHERE COALESCE(is_deleted, 0) = 0'
    ).get();

    if (activeAppsCount && activeAppsCount.c <= 1) {
      return res.status(400).json({ error: 'Cannot delete or archive the only active app in the system.' });
    }

    const app = await testsDb.prepare('SELECT id, name, is_deleted FROM apps WHERE id = ?').get(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Soft delete: set is_deleted = 1 and recorded deleted_at timestamp
    await testsDb.prepare(`
      UPDATE apps SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);

    cache.clear();

    res.json({
      message: `App "${app.name}" was successfully archived. All database history and test records have been preserved and can be viewed in Archive Settings.`,
      id,
      is_deleted: true
    });
  } catch (error) {
    console.error('Delete app error:', error);
    res.status(500).json({ error: 'Server error archiving app' });
  }
});

// Restore an Archived App (admin only)
router.patch('/:id/restore', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const app = await testsDb.prepare('SELECT id, name, is_deleted FROM apps WHERE id = ?').get(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    await testsDb.prepare(`
      UPDATE apps SET is_deleted = 0, deleted_at = NULL WHERE id = ?
    `).run(id);

    cache.clear();

    res.json({
      message: `Application "${app.name}" has been restored to active status.`,
      id,
      is_deleted: false
    });
  } catch (error) {
    console.error('Restore app error:', error);
    res.status(500).json({ error: 'Server error restoring app' });
  }
});

module.exports = router;
