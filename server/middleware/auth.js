const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { testsDb } = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function parseCookies(req) {
  if (req.cookies && typeof req.cookies === 'object') {
    return req.cookies;
  }
  const cookieHeader = req.headers && req.headers['cookie'];
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const parts = c.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  });
  return cookies;
}

const authenticateToken = async (req, res, next) => {
  const cookies = parseCookies(req);

  // 1. Check for API key in X-API-Key header, Authorization header, query, or cookies
  const apiKeyHeader = req.headers['x-api-key'] || req.headers['api-key'] || req.headers['x-api-token'];
  const authHeader = req.headers['authorization'];
  const queryApiKey = req.query && (req.query.api_key || req.query.apiKey || req.query.key);
  const cookieApiKey = cookies['api_key'] || cookies['apiKey'] || cookies['qc_key'];

  let candidateApiKey = null;
  if (apiKeyHeader && typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    candidateApiKey = apiKeyHeader.trim();
  } else if (authHeader && (authHeader.startsWith('Bearer qc_') || authHeader.startsWith('ApiKey ') || authHeader.startsWith('apikey ') || authHeader.startsWith('Token qc_'))) {
    candidateApiKey = authHeader.split(' ')[1]?.trim();
  } else if (authHeader && authHeader.trim().startsWith('qc_')) {
    candidateApiKey = authHeader.trim();
  } else if (queryApiKey && typeof queryApiKey === 'string' && queryApiKey.trim()) {
    candidateApiKey = queryApiKey.trim();
  } else if (cookieApiKey && typeof cookieApiKey === 'string' && cookieApiKey.trim()) {
    candidateApiKey = cookieApiKey.trim();
  } else if (req.query) {
    const qToken = req.query.token || req.query.auth_token || req.query.access_token;
    if (qToken && typeof qToken === 'string' && qToken.trim().startsWith('qc_')) {
      candidateApiKey = qToken.trim();
    }
  }

  if (candidateApiKey) {
    try {
      const keyHash = crypto.createHash('sha256').update(candidateApiKey).digest('hex');
      const keyRow = await testsDb.prepare(`
        SELECT ak.id as key_id, ak.name as key_name, ak.key_prefix, ak.role as key_role, ak.is_active,
               COALESCE(ak.app_id, 1) as app_id,
               u.id as user_id, u.username, u.is_admin, u.is_suspended, u.user_groups
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = ?
      `).get(keyHash);

      if (!keyRow) {
        return res.status(401).json({ error: 'Invalid or unrecognized API key' });
      }

      if (!keyRow.is_active) {
        return res.status(403).json({ error: 'API key is deactivated' });
      }

      if (keyRow.is_suspended) {
        return res.status(403).json({ error: 'User account associated with this API key is suspended' });
      }

      let groups = [];
      try {
        groups = typeof keyRow.user_groups === 'string' ? JSON.parse(keyRow.user_groups) : (keyRow.user_groups || []);
      } catch {
        groups = [];
      }

      const role = keyRow.key_role || 'tester';
      if (role === 'admin' && !groups.includes('admins')) {
        groups.push('admins');
      } else if (role === 'developer' && !groups.includes('developers')) {
        groups.push('developers');
      } else if (role === 'tester' && !groups.includes('testers')) {
        groups.push('testers');
      }

      req.user = {
        userId: keyRow.user_id,
        username: keyRow.username,
        isAdmin: !!keyRow.is_admin || role === 'admin',
        isSuspended: !!keyRow.is_suspended,
        userGroups: groups,
        apiKeyId: keyRow.key_id,
        apiKeyName: keyRow.key_name,
        role: role,
        isApiKey: true,
        appId: keyRow.app_id || 1,
        assignedApps: [keyRow.app_id || 1]
      };

      if (!req.headers['x-app-id'] && keyRow.app_id) {
        req.headers['x-app-id'] = String(keyRow.app_id);
      }

      // Asynchronously record last_used_at without awaiting
      Promise.resolve(
        testsDb.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(keyRow.key_id)
      ).catch(err => console.warn('Non-fatal: failed to update api_keys last_used_at:', err.message));

      return next();
    } catch (err) {
      console.error('API Key verification error:', err);
      return res.status(500).json({ error: 'Authentication error' });
    }
  }

  // 2. Check for standard JWT Bearer token across Authorization header, custom headers, query params, and cookies
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]?.trim();
  } else if (authHeader && !authHeader.startsWith('ApiKey ') && !authHeader.startsWith('apikey ') && !authHeader.startsWith('qc_')) {
    token = authHeader.trim();
  }

  if (!token && req.headers['x-access-token']) {
    token = String(req.headers['x-access-token']).trim();
  }

  // Query parameter fallback (?token=... or ?auth_token=... or ?access_token=...)
  if (!token && req.query) {
    const qToken = req.query.token || req.query.auth_token || req.query.access_token;
    if (qToken && typeof qToken === 'string' && qToken.trim() && !qToken.startsWith('qc_')) {
      token = qToken.trim();
    }
  }

  // Cookie fallback (token, auth_token, jwt, access_token)
  if (!token) {
    const cookieToken = cookies['token'] || cookies['auth_token'] || cookies['jwt'] || cookies['access_token'];
    if (cookieToken && typeof cookieToken === 'string' && cookieToken.trim() && !cookieToken.startsWith('qc_')) {
      token = cookieToken.trim();
    }
  }
  
  if (!token) {
    return res.status(401).json({ error: 'Access token or API key required' });
  }

  if (token.startsWith('qc_')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    // If this session was authenticated via an API key, check if key was revoked or deactivated
    if (user && user.apiKeyId) {
      try {
        const activeKey = await testsDb.prepare('SELECT id, is_active FROM api_keys WHERE id = ?').get(user.apiKeyId);
        if (!activeKey || !activeKey.is_active) {
          return res.status(401).json({ error: 'The key used for this session has been revoked or deactivated' });
        }
      } catch (keyErr) {
        console.error('Error verifying session key:', keyErr);
      }
    }

    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const groups = req.user.userGroups || [];
  const isAdmin = !!req.user.isAdmin || req.user.role === 'admin' || groups.includes('admins');
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireDeveloper = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const groups = req.user.userGroups || [];
  const isAuthorized = req.user.isAdmin || groups.includes('admins') || groups.includes('developers');
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Developer or admin access required' });
  }
  next();
};

const requireReportAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const groups = req.user.userGroups || [];
  const isFullAccess = req.user.isAdmin || groups.includes('admins') || groups.includes('developers');
  const isTester = groups.includes('testers');
  if (!isFullAccess && !isTester) {
    return res.status(403).json({ error: 'Report access required' });
  }
  if (!isFullAccess) {
    req.reportScope = 'self';
    req.selfUserId = req.user.userId;
  } else {
    req.reportScope = 'all';
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireDeveloper,
  requireReportAccess
};