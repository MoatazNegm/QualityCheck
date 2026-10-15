const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { testsDb, usersDb } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { isGlobalAdminUser, getUserAssignedApps, canUserAccessApp } = require('../utils/appContext');

// List API keys (Admin only, strictly filtered to caller's app scope)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const isGlobal = isGlobalAdminUser(req.user);
    const userAssigned = getUserAssignedApps(req.user);
    const filterAppId = req.query.appId && req.query.appId !== 'all' ? parseInt(req.query.appId, 10) : null;

    if (!isGlobal) {
      if (filterAppId && !userAssigned.includes(filterAppId)) {
        return res.status(403).json({ error: 'You do not have access to keys for this application' });
      }
    }

    let sql = `
      SELECT ak.id, ak.name, ak.key_prefix, ak.role, ak.is_active,
             ak.created_at, ak.last_used_at, ak.user_id,
             COALESCE(ak.app_id, 1) as app_id,
             COALESCE(a.name, 'TopStor') as app_name,
             u.username, u.is_suspended
      FROM api_keys ak
      JOIN users u ON ak.user_id = u.id
      LEFT JOIN apps a ON ak.app_id = a.id
    `;
    const conditions = [];
    const args = [];

    if (filterAppId) {
      conditions.push('ak.app_id = ?');
      args.push(filterAppId);
    } else if (!isGlobal) {
      if (userAssigned.length === 0) {
        return res.json([]);
      }
      conditions.push(`ak.app_id IN (${userAssigned.map(() => '?').join(',')})`);
      args.push(...userAssigned);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY ak.created_at DESC';

    const keys = await testsDb.prepare(sql).all(...args);
    res.json(keys);
  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate a new API key scoped to a specific application (Admin only)
// If creating an AI / bot user, that user is created for and assigned to this application ONLY
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, role = 'tester', userId, userName, appId } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Key name / description is required' });
    }

    const isGlobal = isGlobalAdminUser(req.user);
    const userAssigned = getUserAssignedApps(req.user);
    const defaultAppId = userAssigned[0] || 1;

    // Determine target app for this key
    const targetAppId = parseInt(appId || req.headers['x-app-id'], 10) || defaultAppId;

    if (!isGlobal && !userAssigned.includes(targetAppId)) {
      return res.status(403).json({ error: 'You do not have permission to create keys for this application' });
    }

    const targetApp = await testsDb.prepare(
      'SELECT id, name, is_deleted, is_suspended FROM apps WHERE id = ?'
    ).get(targetAppId);

    if (!targetApp || targetApp.is_deleted) {
      return res.status(400).json({ error: 'Selected application does not exist or has been archived' });
    }

    const validRoles = ['tester', 'developer', 'admin'];
    const chosenRole = validRoles.includes(role) ? role : 'tester';

    let targetUserId = userId ? parseInt(userId, 10) : null;
    let targetUsername = userName ? String(userName).trim() : null;

    if (targetUserId) {
      const existingUser = await usersDb.prepare('SELECT id, username FROM users WHERE id = ?').get(targetUserId);
      if (!existingUser) {
        return res.status(404).json({ error: 'Specified user ID not found' });
      }
      targetUsername = existingUser.username;

      // Ensure existing user is mapped to this app
      await testsDb.prepare('INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)').run(targetUserId, targetAppId);
    } else {
      // Determine the user name to link or create
      const finalUsername = (targetUsername || String(name).trim()).replace(/\s+/g, '_');
      if (!finalUsername) {
        return res.status(400).json({ error: 'A valid username is required' });
      }

      // Check if user already exists
      const existingUser = await usersDb.prepare('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)').get(finalUsername);
      if (existingUser) {
        targetUserId = existingUser.id;
        targetUsername = existingUser.username;

        // Ensure user is mapped to this app
        await testsDb.prepare('INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)').run(targetUserId, targetAppId);
      } else {
        // Create a new AI / bot user for this key assigned to THIS APP ONLY.
        // App-scoped users are NEVER given global admin privileges (is_admin = 0).
        const randomPassword = crypto.randomBytes(16).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPassword, 10);
        const groups = chosenRole === 'admin' ? ['admins'] : chosenRole === 'developer' ? ['developers'] : ['testers'];

        const newUserResult = await usersDb.prepare(`
          INSERT INTO users (username, password_hash, is_admin, is_suspended, user_groups)
          VALUES (?, ?, 0, 0, ?)
        `).run(finalUsername, hashedPassword, JSON.stringify(groups));

        targetUserId = newUserResult.lastInsertRowid;
        targetUsername = finalUsername;

        // Assign user exclusively to this application
        await testsDb.prepare('INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)').run(targetUserId, targetAppId);

        // If tester role, assign all active non-deleted tests of THIS APP ONLY
        if (chosenRole === 'tester') {
          try {
            const activeAppTests = await testsDb.prepare(`
              SELECT id FROM tests
              WHERE app_id = ? AND COALESCE(is_deleted, 0) = 0
            `).all(targetAppId);

            for (const t of activeAppTests) {
              await testsDb.prepare('INSERT OR IGNORE INTO test_assignments (test_id, user_id) VALUES (?, ?)').run(t.id, targetUserId);
            }
          } catch (assignErr) {
            console.warn('Non-fatal: failed to auto-assign app tests to new API key user:', assignErr.message);
          }
        }
      }
    }

    // Generate cryptographically secure API key
    // Prefix 'qc_' followed by 48 hex characters
    const randomHex = crypto.randomBytes(24).toString('hex');
    const rawApiKey = `qc_${randomHex}`;
    const keyPrefix = `qc_${randomHex.substring(0, 8)}...`;
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    const result = await testsDb.prepare(`
      INSERT INTO api_keys (name, key_hash, key_prefix, user_id, role, is_active, app_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(String(name).trim(), keyHash, keyPrefix, targetUserId, chosenRole, targetAppId);

    res.status(201).json({
      message: 'API key created successfully. Please copy it now as it will not be displayed again.',
      key: rawApiKey,
      apiKey: {
        id: result.lastInsertRowid,
        name: String(name).trim(),
        key_prefix: keyPrefix,
        role: chosenRole,
        user_id: targetUserId,
        username: targetUsername,
        app_id: targetAppId,
        app_name: targetApp.name,
        is_active: 1,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Toggle API key active status (Admin only)
router.patch('/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const key = await testsDb.prepare('SELECT id, is_active, app_id FROM api_keys WHERE id = ?').get(id);
    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (!canUserAccessApp(req.user, key.app_id || 1)) {
      return res.status(403).json({ error: 'You do not have access to manage this key' });
    }

    const newStatus = key.is_active ? 0 : 1;
    await testsDb.prepare('UPDATE api_keys SET is_active = ? WHERE id = ?').run(newStatus, id);

    res.json({ message: `API key ${newStatus ? 'activated' : 'deactivated'} successfully`, is_active: newStatus });
  } catch (error) {
    console.error('Toggle API key error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete / Revoke API key (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const key = await testsDb.prepare('SELECT id, user_id, name, app_id FROM api_keys WHERE id = ?').get(id);
    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (!canUserAccessApp(req.user, key.app_id || 1)) {
      return res.status(403).json({ error: 'You do not have access to revoke this key' });
    }

    // Delete the API key from api_keys table - user account is preserved!
    await testsDb.prepare('DELETE FROM api_keys WHERE id = ?').run(id);

    // Invalidate active sessions for this user so they cannot remain logged in via the revoked key
    if (key.user_id) {
      try {
        await usersDb.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(key.user_id);
      } catch (sessErr) {
        console.warn('Non-fatal: failed to clear user sessions on key revoke:', sessErr.message);
      }
    }

    res.json({
      message: `API key "${key.name}" revoked successfully. The user account has been preserved and can be issued a new key later.`,
      user_id: key.user_id
    });
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Inspect caller identity (Self-check endpoint)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      authenticated: true,
      user: {
        userId: req.user.userId,
        username: req.user.username,
        isAdmin: req.user.isAdmin,
        isGlobalAdmin: req.user.isGlobalAdmin || false,
        userGroups: req.user.userGroups || [],
        role: req.user.role || (req.user.isAdmin ? 'admin' : 'tester'),
        isApiKey: !!req.user.isApiKey,
        apiKeyName: req.user.apiKeyName || null,
        appId: req.user.appId || 1,
        assignedApps: req.user.assignedApps || [req.user.appId || 1]
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

