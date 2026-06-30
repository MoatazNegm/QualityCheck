const express = require('express');
const router = express.Router();
const { testsDb, usersDb } = require('../db/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    // Accept any file type for configuration files
    cb(null, true);
  }
});

// Get next unattempted step for a user and test
router.get('/user/:userId/test/:testId/next', (req, res) => {
  try {
    const { userId, testId } = req.params;
    
    // Get test name
    const test = testsDb.prepare('SELECT name FROM tests WHERE id = ?').get(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    // Get all steps ordered by step_number
    const steps = testsDb.prepare('SELECT * FROM test_steps WHERE test_id = ? ORDER BY step_number').all(testId);
    
    // Get attempted step IDs
    const attemptedStepIds = testsDb.prepare(
      'SELECT step_id FROM test_results WHERE user_id = ? AND test_id = ?'
    ).all(userId, testId).map(row => row.step_id);
    
    // Find first unattempted step
    const nextStep = steps.find(step => !attemptedStepIds.includes(step.id));
    
    if (!nextStep) {
      return res.status(404).json({ error: 'No more steps' });
    }
    
    res.json({
      step: nextStep,
      test_name: test.name
    });
  } catch (error) {
    console.error('Error fetching next step:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get results for a user and test
router.get('/user/:userId/test/:testId', (req, res) => {
  try {
    const { userId, testId } = req.params;
    
    const results = testsDb.prepare(`
      SELECT tr.*, ts.description as step_description, ts.success_symptom, ts.value
      FROM test_results tr
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ? AND tr.test_id = ?
      ORDER BY tr.executed_at DESC
    `).all(userId, testId);
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit test result
router.post('/:testId/steps/:stepId', upload.single('configFile'), async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const userId = req.body.userId || 1; // In real app, get from auth token
    const { result, comment } = req.body;
    
    if (!result || !['pass', 'fail'].includes(result)) {
      return res.status(400).json({ error: 'Result must be pass or fail' });
    }
    
    // Get user from database (for validation)
    const user = usersDb.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let configFilePath = null;
    if (req.file) {
      configFilePath = `/uploads/${req.file.filename}`;
    }
    
    const resultId = testsDb.prepare(`
      INSERT INTO test_results (user_id, test_id, step_id, result, comment, config_file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, testId, stepId, result, comment || null, configFilePath);
    
    res.json({ id: resultId.lastInsertRowid, message: 'Result submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all results for user (for reporting)
router.get('/user/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    const results = testsDb.prepare(`
      SELECT tr.*, t.name as test_name, ts.description as step_description
      FROM test_results tr
      JOIN tests t ON tr.test_id = t.id
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ?
      ORDER BY tr.executed_at DESC
    `).all(userId);
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;