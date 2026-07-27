const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
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