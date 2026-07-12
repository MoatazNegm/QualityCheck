const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const { usersDb } = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN_EXPIRATION = '24h';

// Ensure the default admin user exists with password 'admin'.
async function initializeAdminUser() {
  try {
    const admin = usersDb.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    
    const hashedPassword = await bcrypt.hash('admin', 10);
    
    if (!admin) {
      usersDb.prepare(`
        INSERT INTO users (username, password_hash, is_admin)
        VALUES (?, ?, 1)
      `).run('admin', hashedPassword);
      
      console.log('Default admin user (admin/admin) created');
    } else {
      usersDb.prepare(`
        UPDATE users SET password_hash = ? WHERE username = ?
      `).run(hashedPassword, 'admin');
      
      console.log('Default admin user (admin/admin) password reset');
    }
  } catch (error) {
    console.error('Error initializing admin user:', error);
  }
}

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = usersDb.prepare(
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
      { userId: user.id, username: user.username, isAdmin: !!user.is_admin },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRATION }
    );

    // Store session
    usersDb.prepare(`
      INSERT INTO user_sessions (user_id, token, expires_at)
      VALUES (?, ?, datetime('now', '+24 hours'))
    `).run(user.id, token);

    res.json({ token, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } });
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
    res.json({ valid: true, user: { ...decoded, isAdmin: !!decoded.isAdmin } });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (token) {
    usersDb.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
  }
  
  res.json({ message: 'Logged out successfully' });
});

module.exports = { router, initializeAdminUser };