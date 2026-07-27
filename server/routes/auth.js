const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const { usersDb } = require('../db/db');
const { authenticateToken } = require('../middleware/auth');

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

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { dbReady } = require('../db/db');
    if (dbReady) await dbReady;

    const { username, password } = req.body;
    
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
    
    const isValid = await bcrypt.compare(String(password).trim(), user.password_hash);
    
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

    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        isAdmin: !!user.is_admin,
        isSuspended: !!user.is_suspended,
        userGroups: groups
      },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRATION }
    );

    // Store session
    try {
      await usersDb.prepare(`
        INSERT INTO user_sessions (user_id, token, expires_at)
        VALUES (?, ?, datetime('now', '+24 hours'))
      `).run(user.id, token);
    } catch (sessionErr) {
      console.warn('Non-fatal session store error:', sessionErr);
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: !!user.is_admin,
        isSuspended: !!user.is_suspended,
        userGroups: groups
      }
    });
  } catch (error) {
    console.error('Login route error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Verify token
router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userGroups = decoded.userGroups || (decoded.isAdmin ? ['admins'] : ['testers']);
    res.json({
      valid: true,
      user: {
        ...decoded,
        id: decoded.userId,
        isAdmin: !!decoded.isAdmin,
        isSuspended: !!decoded.isSuspended,
        userGroups
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (token) {
    try {
      await usersDb.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    } catch (e) {
      console.error('Logout db error:', e);
    }
  }
  
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