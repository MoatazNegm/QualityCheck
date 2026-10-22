const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const { usersDb, testsDb } = require('../db/db');
const { authenticateToken } = require('../middleware/auth');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN_EXPIRATION = '24h';

// Ensure the default admin user exists (creates with 'admin' password if missing, preserves custom password if already exists).
async function ensureAdminUser() {
  try {
    const { dbReady } = require('../db/db');
    if (dbReady) await dbReady;

    const admin = await usersDb.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    
    if (!admin) {
      const hashedPassword = await bcrypt.hash('admin', 10);
      await usersDb.prepare(`
        INSERT INTO users (username, password_hash, is_admin, is_suspended, user_groups)
        VALUES (?, ?, 1, 0, '["admins"]')
      `).run('admin', hashedPassword);
      
      console.log('Default admin user (admin/admin) created');
    } else {
      let groups = [];
      try {
        groups = typeof admin.user_groups === 'string' ? JSON.parse(admin.user_groups) : (admin.user_groups || []);
      } catch {
        groups = [];
      }
      if (admin.is_admin && !admin.is_suspended && groups.includes('admins')) {
        return; // already correct; skip the write on every cold start
      }
      if (!groups.includes('admins')) {
        groups.push('admins');
      }
      await usersDb.prepare(`
        UPDATE users SET is_admin = 1, is_suspended = 0, user_groups = ? WHERE username = 'admin'
      `).run(JSON.stringify(groups));
      
      console.log('Default admin user permissions verified (password preserved)');
    }
  } catch (error) {
    console.error('Failed to ensure admin user:', error);
  }
}

// Query apps assigned to a user by username (used by logon screen to determine available apps)
router.get('/user-apps', async (req, res) => {
  try {
    const { dbReady } = require('../db/db');
    if (dbReady) await dbReady;

    const username = req.query.username;
    if (!username || !String(username).trim()) {
      return res.json({ exists: false, apps: [] });
    }
    const cleanUsername = String(username).trim();
    const user = await usersDb.prepare('SELECT id, username, is_admin, user_groups, is_suspended FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);

    if (!user) {
      return res.json({ exists: false, apps: [] });
    }

    let groups = [];
    try {
      groups = typeof user.user_groups === 'string' ? JSON.parse(user.user_groups) : (user.user_groups || []);
    } catch {
      groups = [];
    }
    const isGlobal = (user.username.toLowerCase() === 'admin' || user.id === 1);

    const allApps = await testsDb.prepare(`
      SELECT id, name, description, COALESCE(is_suspended, 0) as is_suspended
      FROM apps
      WHERE COALESCE(is_deleted, 0) = 0
      ORDER BY id
    `).all();

    if (isGlobal) {
      return res.json({
        exists: true,
        isAdmin: true,
        isGlobalAdmin: true,
        apps: allApps
      });
    }

    const userApps = await testsDb.prepare(`
      SELECT a.id, a.name, a.description, COALESCE(a.is_suspended, 0) as is_suspended
      FROM apps a
      JOIN user_apps ua ON a.id = ua.app_id
      WHERE ua.user_id = ? AND COALESCE(a.is_deleted, 0) = 0
      ORDER BY a.id
    `).all(user.id);

    return res.json({
      exists: true,
      isAdmin: Boolean(user.is_admin || groups.includes('admins')),
      isGlobalAdmin: false,
      apps: userApps
    });
  } catch (error) {
    console.error('user-apps error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login endpoint - supports both credentials (username + password) and generated API keys
router.post('/login', async (req, res) => {
  try {
    const { dbReady } = require('../db/db');
    if (dbReady) await dbReady;

    const { username, password, apiKey, key } = req.body;
    
    // Check if the caller provided an API key directly or in one of the fields
    let candidateApiKey = null;
    if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
      candidateApiKey = apiKey.trim();
    } else if (key && typeof key === 'string' && key.trim()) {
      candidateApiKey = key.trim();
    } else if (password && typeof password === 'string' && password.trim().startsWith('qc_')) {
      candidateApiKey = password.trim();
    } else if (username && typeof username === 'string' && username.trim().startsWith('qc_') && (!password || !password.trim())) {
      candidateApiKey = username.trim();
    }

    // 1. If an API key was supplied, authenticate via API key
    if (candidateApiKey) {
      const keyHash = crypto.createHash('sha256').update(candidateApiKey).digest('hex');
      const keyRow = await testsDb.prepare(`
        SELECT ak.id as key_id, ak.name as key_name, ak.role as key_role, ak.is_active,
               COALESCE(ak.app_id, 1) as app_id,
               u.id as user_id, u.username, u.is_admin, u.is_suspended, u.user_groups
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = ?
      `).get(keyHash);

      if (!keyRow) {
        return res.status(401).json({ error: 'Invalid or revoked key. This key does not exist or has been revoked.' });
      }

      if (!keyRow.is_active) {
        return res.status(403).json({ error: 'This key has been deactivated. Please contact an administrator.' });
      }

      if (keyRow.is_suspended) {
        return res.status(403).json({ error: 'Account is suspended. Please contact administrator.' });
      }

      // If a specific username was also provided, ensure it matches the key's owner
      if (username && typeof username === 'string' && !username.trim().startsWith('qc_')) {
        if (keyRow.username.toLowerCase() !== username.trim().toLowerCase()) {
          return res.status(401).json({ error: 'Provided key does not belong to the specified username' });
        }
      }

      let groups = [];
      try {
        groups = typeof keyRow.user_groups === 'string' ? JSON.parse(keyRow.user_groups) : (keyRow.user_groups || []);
      } catch {
        groups = [];
      }
      const role = keyRow.key_role || 'tester';
      if (role === 'admin' && !groups.includes('admins')) groups.push('admins');
      if (role === 'developer' && !groups.includes('developers')) groups.push('developers');
      if (role === 'tester' && !groups.includes('testers')) groups.push('testers');
      if (groups.length === 0) {
        groups = keyRow.is_admin ? ['admins'] : ['testers'];
      }

      const isAdmin = role === 'admin';
      const keyAppId = keyRow.app_id || 1;
      const userApps = await testsDb.prepare(`
        SELECT a.id, a.name, a.description, COALESCE(a.is_suspended, 0) as is_suspended
        FROM apps a
        WHERE a.id = ? AND COALESCE(a.is_deleted, 0) = 0
      `).all(keyAppId);

      const targetApp = await testsDb.prepare('SELECT id, name, is_suspended, is_deleted FROM apps WHERE id = ?').get(keyAppId);
      if (targetApp) {
        if (targetApp.is_deleted) {
          return res.status(403).json({ error: 'The application for this key is archived or does not exist.' });
        }
        if (targetApp.is_suspended && !isAdmin) {
          return res.status(403).json({ error: `Application "${targetApp.name}" is currently suspended. Access is restricted to administrators.` });
        }
      }

      const token = jwt.sign(
        {
          userId: keyRow.user_id,
          username: keyRow.username,
          isAdmin: isAdmin,
          isGlobalAdmin: false,
          isSuspended: !!keyRow.is_suspended,
          userGroups: groups,
          apiKeyId: keyRow.key_id,
          role: role,
          isApiKey: true,
          appId: keyAppId,
          assignedApps: [keyAppId]
        },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRATION }
      );

      // Record last_used_at on api_keys
      Promise.resolve(
        testsDb.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(keyRow.key_id)
      ).catch(e => console.warn('Non-fatal: failed to update api_keys last_used_at:', e.message));

      // Store session
      try {
        await usersDb.prepare(`
          INSERT INTO user_sessions (user_id, token, expires_at)
          VALUES (?, ?, datetime('now', '+24 hours'))
        `).run(keyRow.user_id, token);
      } catch (sessionErr) {
        console.warn('Non-fatal session store error:', sessionErr);
      }

      const cookieOptions = {
        path: '/',
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        httpOnly: false
      };
      res.cookie('token', token, cookieOptions);
      res.cookie('auth_token', token, cookieOptions);

      return res.json({
        token,
        user: {
          id: keyRow.user_id,
          username: keyRow.username,
          isAdmin: isAdmin,
          isGlobalAdmin: false,
          isSuspended: !!keyRow.is_suspended,
          userGroups: groups,
          isApiKey: true,
          apiKeyId: keyRow.key_id,
          appId: keyAppId,
          assignedApps: [keyAppId]
        },
        assignedApps: userApps,
        selectedApp: keyAppId
      });
    }

    // 2. Standard username + password login
    const { selectedApp, appId } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const cleanUsername = String(username).trim();
    
    const user = await usersDb.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).get(cleanUsername);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_suspended) {
      return res.status(403).json({ error: 'Account is suspended. Please contact administrator.' });
    }
    
    let isValid = await bcrypt.compare(String(password).trim(), user.password_hash);
    let usedApiKeyId = null;

    // Fallback: check if the provided password is an active API key assigned to this user
    if (!isValid) {
      const pwHash = crypto.createHash('sha256').update(String(password).trim()).digest('hex');
      const keyMatch = await testsDb.prepare(
        'SELECT id, is_active FROM api_keys WHERE user_id = ? AND key_hash = ?'
      ).get(user.id, pwHash);
      if (keyMatch) {
        if (!keyMatch.is_active) {
          return res.status(403).json({ error: 'The key provided for this account has been deactivated.' });
        }
        isValid = true;
        usedApiKeyId = keyMatch.id;
      }
    }
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    let groups = [];
    try {
      groups = typeof user.user_groups === 'string' ? JSON.parse(user.user_groups) : (user.user_groups || []);
    } catch {
      groups = [];
    }
    if (groups.length === 0) {
      groups = user.is_admin ? ['admins'] : ['testers'];
    }

    const payload = {
      userId: user.id,
      username: user.username,
      isAdmin: !!user.is_admin,
      isSuspended: !!user.is_suspended,
      userGroups: groups
    };
    if (usedApiKeyId) {
      payload.apiKeyId = usedApiKeyId;
      payload.isApiKey = true;
    }

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });

    // Store session
    try {
      await usersDb.prepare(`
        INSERT INTO user_sessions (user_id, token, expires_at)
        VALUES (?, ?, datetime('now', '+24 hours'))
      `).run(user.id, token);
    } catch (sessionErr) {
      console.warn('Non-fatal session store error:', sessionErr);
    }

    const cookieOptions = {
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      httpOnly: false
    };
    res.cookie('token', token, cookieOptions);
    res.cookie('auth_token', token, cookieOptions);

    const isGlobal = (user.username.toLowerCase() === 'admin' || user.id === 1);
    const isAdmin = Boolean(user.is_admin || groups.includes('admins'));

    const allApps = await testsDb.prepare(`
      SELECT id, name, description, COALESCE(is_suspended, 0) as is_suspended
      FROM apps
      WHERE COALESCE(is_deleted, 0) = 0
      ORDER BY id
    `).all();

    let userApps = isGlobal ? allApps : await testsDb.prepare(`
      SELECT a.id, a.name, a.description, COALESCE(a.is_suspended, 0) as is_suspended
      FROM apps a
      JOIN user_apps ua ON a.id = ua.app_id
      WHERE ua.user_id = ? AND COALESCE(a.is_deleted, 0) = 0
      ORDER BY a.id
    `).all(user.id);

    const reqSelectedApp = (req.body && req.body.selectedApp !== undefined && req.body.selectedApp !== '') ? req.body.selectedApp : (req.body && req.body.appId !== undefined ? req.body.appId : undefined);
    let resolvedSelectedApp;
    if (isGlobal) {
      resolvedSelectedApp = reqSelectedApp !== undefined ? reqSelectedApp : 'admin';
    } else {
      const allowedIds = userApps.map(a => a.id);
      const requestedId = parseInt(reqSelectedApp, 10);
      if (!isNaN(requestedId) && allowedIds.includes(requestedId)) {
        resolvedSelectedApp = requestedId;
      } else {
        resolvedSelectedApp = userApps[0]?.id || 1;
      }
    }

    if (resolvedSelectedApp !== 'admin') {
      const targetAppId = parseInt(resolvedSelectedApp, 10);
      if (!isNaN(targetAppId)) {
        const targetApp = await testsDb.prepare('SELECT id, name, is_suspended, is_deleted FROM apps WHERE id = ?').get(targetAppId);
        if (targetApp) {
          if (targetApp.is_deleted) {
            return res.status(403).json({ error: 'The selected application is archived or does not exist.' });
          }
          if (targetApp.is_suspended && !isAdmin) {
            return res.status(403).json({ error: `Application "${targetApp.name}" is currently suspended. Access is restricted to administrators.` });
          }
        }
      }
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: isAdmin,
        isGlobalAdmin: isGlobal,
        isSuspended: !!user.is_suspended,
        userGroups: groups,
        assignedApps: userApps.map(a => a.id)
      },
      assignedApps: userApps,
      selectedApp: resolvedSelectedApp
    });
  } catch (error) {
    console.error('Login route error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Verify token
router.get('/verify', async (req, res) => {
  let token = req.headers.authorization?.split(' ')[1];
  if (!token && req.headers.authorization && !req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.trim();
  }
  if (!token && req.headers['x-access-token']) {
    token = String(req.headers['x-access-token']).trim();
  }
  if (!token && req.query) {
    token = req.query.token || req.query.auth_token || req.query.access_token;
  }
  if (!token && req.headers && req.headers.cookie) {
    const cookies = {};
    req.headers.cookie.split(';').forEach(c => {
      const parts = c.split('=');
      if (parts.length >= 2) {
        cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
      }
    });
    token = cookies['token'] || cookies['auth_token'] || cookies['jwt'] || cookies['access_token'];
  }
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // If this session was issued for a generated key, verify the key has not been revoked
    if (decoded.apiKeyId) {
      const activeKey = await testsDb.prepare('SELECT id, is_active FROM api_keys WHERE id = ?').get(decoded.apiKeyId);
      if (!activeKey || !activeKey.is_active) {
        return res.status(401).json({ error: 'The key used to log in has been revoked or deactivated' });
      }
    }

    const isGlobal = (decoded.username?.toLowerCase() === 'admin' || decoded.userId === 1) && !decoded.isApiKey;
    const userGroups = decoded.userGroups || (decoded.isAdmin ? ['admins'] : ['testers']);
    const isAdmin = Boolean(decoded.isAdmin || userGroups.includes('admins'));

    const allApps = await testsDb.prepare(`
      SELECT id, name, description, COALESCE(is_suspended, 0) as is_suspended
      FROM apps
      WHERE COALESCE(is_deleted, 0) = 0
      ORDER BY id
    `).all();

    let userApps;
    if (isGlobal) {
      userApps = allApps;
    } else if (decoded.isApiKey && decoded.appId) {
      userApps = await testsDb.prepare(`
        SELECT a.id, a.name, a.description, COALESCE(a.is_suspended, 0) as is_suspended
        FROM apps a
        WHERE a.id = ? AND COALESCE(a.is_deleted, 0) = 0
      `).all(decoded.appId);
    } else {
      userApps = await testsDb.prepare(`
        SELECT a.id, a.name, a.description, COALESCE(a.is_suspended, 0) as is_suspended
        FROM apps a
        JOIN user_apps ua ON a.id = ua.app_id
        WHERE ua.user_id = ? AND COALESCE(a.is_deleted, 0) = 0
        ORDER BY a.id
      `).all(decoded.userId);
    }

    res.json({
      valid: true,
      user: {
        ...decoded,
        id: decoded.userId,
        isAdmin: isAdmin,
        isGlobalAdmin: isGlobal,
        isSuspended: !!decoded.isSuspended,
        isApiKey: !!decoded.isApiKey,
        apiKeyId: decoded.apiKeyId || null,
        userGroups,
        assignedApps: userApps.map(a => a.id)
      },
      assignedApps: userApps,
      allApps: isGlobal ? allApps : undefined
    });
  } catch (error) {
    res.status(401).json({ error: error.message || 'Invalid token' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  let token = req.headers.authorization?.split(' ')[1];
  if (!token && req.query) {
    token = req.query.token || req.query.auth_token;
  }
  if (!token && req.headers && req.headers.cookie) {
    const cookies = {};
    req.headers.cookie.split(';').forEach(c => {
      const parts = c.split('=');
      if (parts.length >= 2) {
        cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
      }
    });
    token = cookies['token'] || cookies['auth_token'];
  }
  
  if (token) {
    try {
      await usersDb.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    } catch (e) {
      console.error('Logout db error:', e);
    }
  }

  res.clearCookie('token', { path: '/' });
  res.clearCookie('auth_token', { path: '/' });
  res.clearCookie('jwt', { path: '/' });
  res.clearCookie('access_token', { path: '/' });
  
  res.json({ message: 'Logged out successfully' });
});

// Change password (authenticated users only)
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (typeof newPassword !== 'string' || newPassword.trim().length === 0) {
      return res.status(400).json({ error: 'New password cannot be empty' });
    }

    const user = await usersDb.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword.trim(), 10);

    await usersDb.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).run(hashedPassword, userId);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router, ensureAdminUser };