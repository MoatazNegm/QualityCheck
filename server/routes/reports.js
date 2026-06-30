const express = require('express');
const router = express.Router();
const { testsDb } = require('../db/db');

// Get detailed test results for a user
router.get('/test/:testId/user/:userId', (req, res) => {
  try {
    const { testId, userId } = req.params;
    
    const test = testsDb.prepare(
      'SELECT * FROM tests WHERE id = ?'
    ).get(testId);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    const steps = testsDb.prepare(`
      SELECT ts.*, 
             COALESCE(tr.result, 'pending') as result,
             tr.comment,
             tr.config_file_path,
             tr.executed_at
      FROM test_steps ts
      LEFT JOIN test_results tr ON ts.id = tr.step_id 
          AND tr.user_id = ? AND tr.test_id = ?
      WHERE ts.test_id = ?
      ORDER BY ts.step_number
    `).all(userId, testId, testId);
    
    const totalValue = steps.reduce((sum, step) => {
      return sum + (step.result === 'pass' ? step.value : 0);
    }, 0);
    
    res.json({
      test,
      steps,
      totalValue
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get monthly financial summary for a user
router.get('/monthly/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    const results = testsDb.prepare(`
      SELECT 
        t.name as test_name,
        SUM(CASE WHEN tr.result = 'pass' THEN ts.value ELSE 0 END) as total_value,
        COUNT(tr.id) as attempts,
        SUM(CASE WHEN tr.result = 'pass' THEN 1 ELSE 0 END) as passes,
        SUM(CASE WHEN tr.result = 'fail' THEN 1 ELSE 0 END) as fails
      FROM test_results tr
      JOIN tests t ON tr.test_id = t.id
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ?
        AND tr.executed_at >= datetime('now', 'start of month')
      GROUP BY tr.test_id
    `).all(userId);
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;