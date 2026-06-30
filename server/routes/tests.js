const express = require('express');
const router = express.Router();
const { testsDb } = require('../db/db');

// Get all tests
router.get('/', (req, res) => {
  try {
    const tests = testsDb.prepare(
      'SELECT * FROM tests ORDER BY id'
    ).all();
    
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get test with steps
router.get('/:id', (req, res) => {
  try {
    const test = testsDb.prepare(
      'SELECT * FROM tests WHERE id = ?'
    ).get(req.params.id);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    const steps = testsDb.prepare(
      'SELECT * FROM test_steps WHERE test_id = ? ORDER BY step_number'
    ).all(req.params.id);
    
    test.steps = steps;
    res.json(test);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create test (admin only)
router.post('/', (req, res) => {
  try {
    const { name, description } = req.body;
    
    const result = testsDb.prepare(`
      INSERT INTO tests (name, description)
      VALUES (?, ?)
    `).run(name, description);
    
    res.json({ id: result.lastInsertRowid, name, description });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add step to test
router.post('/:id/steps', (req, res) => {
  try {
    const { id } = req.params;
    const { step_number, description, success_symptom, value, on_failure } = req.body;
    
    const result = testsDb.prepare(`
      INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, on_failure)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, step_number, description, success_symptom, value || 0, on_failure || 'continue');
    
    res.json({ id: result.lastInsertRowid, test_id: parseInt(id), step_number, description, success_symptom, value, on_failure });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update step
router.put('/:testId/steps/:stepId', (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const { step_number, description, success_symptom, value, on_failure } = req.body;
    
    testsDb.prepare(`
      UPDATE test_steps SET step_number = ?, description = ?, success_symptom = ?, value = ?, on_failure = ?
      WHERE id = ? AND test_id = ?
    `).run(step_number, description, success_symptom, value, on_failure, stepId, testId);
    
    res.json({ message: 'Step updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete step
router.delete('/:testId/steps/:stepId', (req, res) => {
  try {
    const { testId, stepId } = req.params;
    
    testsDb.prepare('DELETE FROM test_steps WHERE id = ? AND test_id = ?').run(stepId, testId);
    res.json({ message: 'Step deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reorder steps
router.put('/:testId/steps/reorder', (req, res) => {
  try {
    const { testId } = req.params;
    const { stepOrder } = req.body;
    
    const transaction = testsDb.transaction((steps) => {
      steps.forEach(({ id, step_number }) => {
        testsDb.prepare('UPDATE test_steps SET step_number = ? WHERE id = ?')
          .run(step_number, id);
      });
    });
    
    transaction(stepOrder);
    res.json({ message: 'Steps reordered successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;