const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { testsDb } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// Get all tests (filtered by assignment for non-admins)
router.get('/', authenticateToken, (req, res) => {
  try {
    let tests;
    if (req.user.isAdmin) {
      tests = testsDb.prepare('SELECT * FROM tests ORDER BY id').all();
    } else {
      tests = testsDb.prepare(`
        SELECT t.* FROM tests t
        INNER JOIN test_assignments ta ON ta.test_id = t.id
        WHERE ta.user_id = ?
        ORDER BY t.id
      `).all(req.user.userId);
    }
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Import tests from Excel file (admin only)
router.post('/import', authenticateToken, requireAdmin, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const imported = [];

    const insertTest = testsDb.prepare('INSERT INTO tests (name, description) VALUES (?, ?)');
    const insertStep = testsDb.prepare(`
      INSERT INTO test_steps (test_id, step_number, description, success_symptom, on_failure, points)
      VALUES (?, ?, ?, ?, 'continue', ?)
    `);

    const importWorkbook = testsDb.transaction(() => {
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (rows.length === 0) continue;

        // Find column keys case-insensitively
        const sampleKeys = Object.keys(rows[0]);
        const testCaseKey = sampleKeys.find(k => k.toLowerCase().includes('test case')) || sampleKeys[0];
        const successKey = sampleKeys.find(k => k.toLowerCase().includes('expected success'));
        const pointsKey = sampleKeys.find(k => k.toLowerCase().includes('points'));

        const result = insertTest.run(sheetName, `Imported from Excel`);
        const testId = result.lastInsertRowid;

        let stepNumber = 1;
        for (const row of rows) {
          const description = String(row[testCaseKey] || '').trim();
          if (!description) continue;
          const successSymptom = successKey ? String(row[successKey] || '').trim() : '';
          const points = pointsKey ? (parseInt(String(row[pointsKey] || ''), 10) || 10) : 10;
          insertStep.run(testId, stepNumber, description, successSymptom, points);
          stepNumber++;
        }

        imported.push({ id: testId, name: sheetName, stepsCount: stepNumber - 1 });
      }
    });

    importWorkbook();
    res.json({ imported });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import Excel file' });
  }
});

// Get assignments for a test (admin only)
router.get('/:id/assignments', authenticateToken, requireAdmin, (req, res) => {
  try {
    const assignments = testsDb.prepare(`
      SELECT user_id FROM test_assignments WHERE test_id = ?
    `).all(req.params.id);
    res.json(assignments.map(a => a.user_id));
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign a user to a test (admin only)
router.post('/:id/assignments', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    testsDb.prepare(`
      INSERT OR IGNORE INTO test_assignments (test_id, user_id) VALUES (?, ?)
    `).run(req.params.id, userId);
    res.json({ message: 'Assigned' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a user assignment (admin only)
router.delete('/:id/assignments/:userId', authenticateToken, requireAdmin, (req, res) => {
  try {
    testsDb.prepare(
      'DELETE FROM test_assignments WHERE test_id = ? AND user_id = ?'
    ).run(req.params.id, req.params.userId);
    res.json({ message: 'Unassigned' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update points for a step (admin only)
router.patch('/:testId/steps/:stepId/points', authenticateToken, requireAdmin, (req, res) => {
  try {
    const points = parseInt(req.body.points, 10);
    if (isNaN(points) || points < 0) {
      return res.status(400).json({ error: 'Points must be a non-negative number' });
    }
    testsDb.prepare('UPDATE test_steps SET points = ? WHERE id = ? AND test_id = ?')
      .run(points, req.params.stepId, req.params.testId);
    res.json({ message: 'Points updated' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete entire test (admin only)
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    testsDb.prepare('DELETE FROM tests WHERE id = ?').run(req.params.id);
    res.json({ message: 'Test deleted' });
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