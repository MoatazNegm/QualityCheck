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

// Ensure the default admin user exists with password 'admin'.
async function ensureAdminUser() {
  try {
    const admin = await usersDb.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    
    const hashedPassword = await bcrypt.hash('admin', 10);
    
    if (!admin) {
      await usersDb.prepare(`
        INSERT INTO users (username, password_hash, is_admin)
        VALUES (?, ?, 1)
      `).run('admin', hashedPassword);
      
      console.log('Default admin user (admin/admin) created');
    } else {
      await usersDb.prepare(`
        UPDATE users SET password_hash = ? WHERE username = ?
      `).run(hashedPassword, 'admin');
      
      console.log('Default admin user (admin/admin) password reset');
    }
  } catch (error) {
    console.error('Failed to ensure admin user:', error);
  }
}

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    await ensureAdminUser();

    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await usersDb.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).get(username);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user.id, username: user.username, isAdmin: !!user.is_admin, isSuspended: !!user.is_suspended },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRATION }
    );

    // Store session
    await usersDb.prepare(`
      INSERT INTO user_sessions (user_id, token, expires_at)
      VALUES (?, ?, datetime('now', '+24 hours'))
    `).run(user.id, token);

    res.json({ token, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin, isSuspended: !!user.is_suspended } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
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
    // Coerce is_admin (SQLite INTEGER 0/1) to a real boolean so the client never
    // receives the number 0, which React would render as the literal text "0".
    res.json({ valid: true, user: { ...decoded, isAdmin: !!decoded.isAdmin, isSuspended: !!decoded.isSuspended } });
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