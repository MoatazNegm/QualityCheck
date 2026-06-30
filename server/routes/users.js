const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { usersDb } = require('../db/db');

// Get all users (admin only)
router.get('/', (req, res) => {
  try {
    const users = usersDb.prepare(
      'SELECT id, username, is_admin, created_at FROM users'
    ).all();
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (admin only)
router.post('/', async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = usersDb.prepare(`
      INSERT INTO users (username, password_hash, is_admin)
      VALUES (?, ?, ?)
    `).run(username, hashedPassword, isAdmin ? 1 : 0);
    
    res.json({ id: result.lastInsertRowid, username, is_admin: isAdmin ? 1 : 0 });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user (admin only)
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    usersDb.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user role (admin only)
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { is_admin } = req.body;
    
    usersDb.prepare(
      'UPDATE users SET is_admin = ? WHERE id = ?'
    ).run(is_admin ? 1 : 0, id);
    
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;