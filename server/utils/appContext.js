/**
 * Application Context & Isolation Helpers
 *
 * Enforces strict per-application isolation across all roles:
 * - Global Admin: only the root system administrator (user 'admin' or id 1 without API key constraint)
 *   can view/manage all apps and access cross-application settings.
 * - App Admins, Developers, Testers: strictly isolated to the apps assigned to them in `user_apps`.
 *   They cannot list, discover, query, or execute against applications outside their assignment.
 * - API Keys: permanently and strictly locked to their single `app_id`.
 */

function isGlobalAdminUser(user) {
  if (!user) return false;
  if (user.isApiKey) return false;
  return Boolean(user.isGlobalAdmin || (user.username === 'admin' && user.isAdmin));
}

function getUserAssignedApps(user) {
  if (!user) return [];
  if (user.isApiKey && user.appId) {
    return [parseInt(user.appId, 10)];
  }
  if (Array.isArray(user.assignedApps) && user.assignedApps.length > 0) {
    return user.assignedApps.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  }
  if (user.appId) {
    return [parseInt(user.appId, 10)];
  }
  return [];
}

function canUserAccessApp(user, appId) {
  if (!user) return false;
  if (isGlobalAdminUser(user)) return true;
  if (appId === 'all') return true; // caller will filter by user's assigned apps
  const targetId = parseInt(appId, 10);
  if (isNaN(targetId)) return false;
  const assigned = getUserAssignedApps(user);
  return assigned.includes(targetId);
}

function getAppId(req) {
  const raw = req.headers['x-app-id'] || (req.query && req.query.appId) || (req.body && req.body.appId);

  // 1. API Keys are permanently pinned to their declared app_id
  if (req.user && req.user.isApiKey && req.user.appId) {
    const keyAppId = parseInt(req.user.appId, 10);
    if (raw && raw !== 'all') {
      const explicitNum = parseInt(raw, 10);
      if (!isNaN(explicitNum) && explicitNum !== keyAppId) {
        return explicitNum; // Explicitly requested foreign app -> triggers 403 Forbidden
      }
    }
    return keyAppId;
  }

  // 2. Global Administrator can select 'all' or any specific app
  if (isGlobalAdminUser(req.user)) {
    if (raw === 'all') return 'all';
    const num = parseInt(raw, 10);
    return isNaN(num) ? 1 : num;
  }

  // 3. App-scoped users (admins, testers, developers)
  const assigned = getUserAssignedApps(req.user);
  const defaultAppId = assigned.length > 0 ? assigned[0] : 1;

  if (raw === 'all') {
    return 'all';
  }

  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const requestedNum = parseInt(raw, 10);
    if (!isNaN(requestedNum)) {
      return requestedNum; // Let canUserAccessApp validate whether user is permitted
    }
  }

  // Default to the user's primary assigned app when not explicitly requested
  return defaultAppId;
}

const requireAppAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const appId = getAppId(req);
  if (appId === 'all') {
    return next();
  }
  if (!canUserAccessApp(req.user, appId)) {
    return res.status(403).json({ error: 'You do not have access to this application' });
  }
  next();
};

const requireGlobalAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!isGlobalAdminUser(req.user)) {
    return res.status(403).json({ error: 'Global administrator privileges required' });
  }
  next();
};

module.exports = {
  isGlobalAdminUser,
  getUserAssignedApps,
  canUserAccessApp,
  getAppId,
  requireAppAccess,
  requireGlobalAdmin
};
