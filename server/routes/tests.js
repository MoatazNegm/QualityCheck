const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { testsDb, bumpRound, getRound } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// Ordered list of tests assigned to a user (loop order = test id ascending)
async function getAssignedTestsOrdered(userId) {
  return await testsDb.prepare(`
    SELECT t.* FROM tests t
    INNER JOIN test_assignments ta ON ta.test_id = t.id
    WHERE ta.user_id = ?
    ORDER BY t.id
  `).all(userId);
}

async function getCurrentVersionId() {
  const row = await testsDb.prepare('SELECT id FROM versions WHERE is_current = 1 LIMIT 1').get();
  return row ? row.id : null;
}

// Returns the currently active (unlocked) test id for a user, creating the
// default (first assigned test) row on first access.
async function getActiveTestId(userId) {
  const row = await testsDb.prepare('SELECT active_test_id, version_id FROM user_loop_state WHERE user_id = ?').get(userId);
  if (row) {
    const currentVersionId = await getCurrentVersionId();
    if (row.version_id && currentVersionId && row.version_id !== currentVersionId) {
      const assigned = await getAssignedTestsOrdered(userId);
      if (assigned.length > 0) {
        const idx = assigned.findIndex(t => t.id === row.active_test_id);
        const nextTest = assigned[(idx + 1) % assigned.length];
        await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
          .run(userId, nextTest.id, currentVersionId);
        return nextTest.id;
      }
    }
    return row.active_test_id;
  }
  const assigned = await getAssignedTestsOrdered(userId);
  const firstId = assigned.length ? assigned[0].id : null;
  if (firstId !== null) {
    const currentVersionId = await getCurrentVersionId();
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, firstId, currentVersionId);
  }
  return firstId;
}

// Whether every step of a test has a recorded result for the user
async function isTestCompleted(userId, testId) {
  const stepCountRow = await testsDb.prepare('SELECT COUNT(*) AS c FROM test_steps WHERE test_id = ?').get(testId);
  const stepCount = stepCountRow ? stepCountRow.c : 0;
  if (stepCount === 0) return false;
  
  const doneCountRow = await testsDb.prepare(
    'SELECT COUNT(*) AS c FROM test_results WHERE user_id = ? AND test_id = ?'
  ).get(userId, testId);
  const doneCount = doneCountRow ? doneCountRow.c : 0;
  
  return doneCount >= stepCount;
}

// Total points awarded for a test (sum of its steps' points)
async function getTestTotalPoints(testId) {
  const row = await testsDb.prepare(
    'SELECT COALESCE(SUM(COALESCE(points, value, 0)), 0) AS total FROM test_steps WHERE test_id = ?'
  ).get(testId);
  return row ? row.total : 0;
}

// Get all tests (filtered by assignment for non-admins, with loop lock status)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let tests;
    if (req.user.isAdmin) {
      const allTests = await testsDb.prepare('SELECT * FROM tests ORDER BY id').all();
      tests = await Promise.all(allTests.map(async t => ({
        ...t,
        locked: false,
        isActive: false,
        completed: false,
        totalPoints: await getTestTotalPoints(t.id)
      })));
    } else {
      const assigned = await getAssignedTestsOrdered(req.user.userId);
      const activeTestId = await getActiveTestId(req.user.userId);
      tests = await Promise.all(assigned.map(async t => ({
        ...t,
        locked: t.id !== activeTestId,
        isActive: t.id === activeTestId,
        completed: await isTestCompleted(req.user.userId, t.id),
        totalPoints: await getTestTotalPoints(t.id)
      })));
    }
    res.json(tests);
  } catch (error) {
    console.error('Get tests error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark the current active test as completed and advance the loop to the next
// assigned test (wrapping around to the first after the last). Per-user.
router.post('/:testId/complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      return res.status(403).json({ error: 'Admins do not use the test loop' });
    }
    const userId = req.user.userId;
    const testId = parseInt(req.params.testId, 10);

    const assigned = await getAssignedTestsOrdered(userId);
    if (assigned.length === 0) {
      return res.status(400).json({ error: 'No tests assigned' });
    }

    const activeTestId = await getActiveTestId(userId);
    if (activeTestId !== testId) {
      return res.status(400).json({ error: 'This test is not the current active test' });
    }

    if (!(await isTestCompleted(userId, testId))) {
      return res.status(400).json({ error: 'Cannot complete an unfinished test' });
    }

    const currentVersionId = await getCurrentVersionId();
    const idx = assigned.findIndex(t => t.id === testId);
    const nextTest = assigned[(idx + 1) % assigned.length];
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, nextTest.id, currentVersionId);
    await bumpRound(userId, nextTest.id);

    res.json({ message: 'Test completed', active_test_id: nextTest.id });
  } catch (error) {
    console.error('Complete test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Re-open a test as the active one (used by "Restart"). Allowed only when the
// test is already the active test or has been completed, so the loop order
// cannot be skipped ahead.
router.post('/:testId/activate', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      return res.status(403).json({ error: 'Admins do not use the test loop' });
    }
    const userId = req.user.userId;
    const testId = parseInt(req.params.testId, 10);

    const assigned = await getAssignedTestsOrdered(userId);
    if (!assigned.some(t => t.id === testId)) {
      return res.status(400).json({ error: 'Test is not assigned to this user' });
    }
    const activeTestId = await getActiveTestId(userId);
    if (activeTestId !== testId && !(await isTestCompleted(userId, testId))) {
      return res.status(400).json({ error: 'Can only re-open the current or a completed test' });
    }

    const currentVersionId = await getCurrentVersionId();
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, testId, currentVersionId);
    await bumpRound(userId, testId);

    res.json({ message: 'Test re-opened', active_test_id: testId });
  } catch (error) {
    console.error('Activate test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// End the current active test early (e.g. a hard-stop failure) and advance the
// loop to the next test. Unlike /complete, this does not require the test to be
// fully finished, but the test must be the user's currently active test.
router.post('/:testId/end', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      return res.status(403).json({ error: 'Admins do not use the test loop' });
    }
    const userId = req.user.userId;
    const testId = parseInt(req.params.testId, 10);

    const assigned = await getAssignedTestsOrdered(userId);
    if (assigned.length === 0) {
      return res.status(400).json({ error: 'No tests assigned' });
    }

    const activeTestId = await getActiveTestId(userId);
    if (activeTestId !== testId) {
      return res.status(400).json({ error: 'This test is not the current active test' });
    }

    const currentVersionId = await getCurrentVersionId();
    const idx = assigned.findIndex(t => t.id === testId);
    const nextTest = assigned[(idx + 1) % assigned.length];
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, nextTest.id, currentVersionId);
    await bumpRound(userId, nextTest.id);

    res.json({ message: 'Test ended', active_test_id: nextTest.id });
  } catch (error) {
    console.error('End test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Import tests from Excel file (admin only)
router.post('/import', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const imported = [];

    const tx = await testsDb.client.transaction('write');
    try {
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (rows.length === 0) continue;

        // Find column keys case-insensitively
        const sampleKeys = Object.keys(rows[0]);
        const testCaseKey = sampleKeys.find(k => k.toLowerCase().includes('test case')) || sampleKeys[0];
        const successKey = sampleKeys.find(k => k.toLowerCase().includes('expected success'));
        const pointsKey = sampleKeys.find(k => k.toLowerCase().includes('points'));

        const result = await tx.execute({
          sql: 'INSERT INTO tests (name, description) VALUES (?, ?)',
          args: [sheetName, 'Imported from Excel']
        });
        const testId = Number(result.lastInsertRowid);

        let stepNumber = 1;
        for (const row of rows) {
          const description = String(row[testCaseKey] || '').trim();
          if (!description) continue;
          const successSymptom = successKey ? String(row[successKey] || '').trim() : '';
          const points = pointsKey ? (parseInt(String(row[pointsKey] || ''), 10) || 10) : 10;
          await tx.execute({
            sql: `INSERT INTO test_steps (test_id, step_number, description, success_symptom, on_failure, points)
                  VALUES (?, ?, ?, ?, 'stop', ?)`,
            args: [testId, stepNumber, description, successSymptom, points]
          });
          stepNumber++;
        }

        imported.push({ id: testId, name: sheetName, stepsCount: stepNumber - 1 });
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    res.json({ imported });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import Excel file' });
  }
});

// Get assignments for a test (admin only)
router.get('/:id/assignments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const assignments = await testsDb.prepare(`
      SELECT user_id FROM test_assignments WHERE test_id = ?
    `).all(req.params.id);
    res.json(assignments.map(a => a.user_id));
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign a user to a test (admin only)
router.post('/:id/assignments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await testsDb.prepare(`
      INSERT OR IGNORE INTO test_assignments (test_id, user_id) VALUES (?, ?)
    `).run(req.params.id, userId);
    res.json({ message: 'Assigned' });
  } catch (error) {
    console.error('Add assignment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a user assignment (admin only)
router.delete('/:id/assignments/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await testsDb.prepare(
      'DELETE FROM test_assignments WHERE test_id = ? AND user_id = ?'
    ).run(req.params.id, req.params.userId);
    res.json({ message: 'Unassigned' });
  } catch (error) {
    console.error('Remove assignment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update points for a step (admin only)
router.patch('/:testId/steps/:stepId/points', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const points = parseInt(req.body.points, 10);
    if (isNaN(points) || points < 0) {
      return res.status(400).json({ error: 'Points must be a non-negative number' });
    }
    await testsDb.prepare('UPDATE test_steps SET points = ?, value = ? WHERE id = ? AND test_id = ?')
      .run(points, points, req.params.stepId, req.params.testId);
    res.json({ message: 'Points updated' });
  } catch (error) {
    console.error('Update points error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete entire test (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await testsDb.prepare('DELETE FROM tests WHERE id = ?').run(req.params.id);
    res.json({ message: 'Test deleted' });
  } catch (error) {
    console.error('Delete test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get test with steps
router.get('/:id', async (req, res) => {
  try {
    const test = await testsDb.prepare(
      'SELECT * FROM tests WHERE id = ?'
    ).get(req.params.id);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    const steps = await testsDb.prepare(
      'SELECT * FROM test_steps WHERE test_id = ? ORDER BY step_number'
    ).all(req.params.id);
    
    test.steps = steps;
    res.json(test);
  } catch (error) {
    console.error('Get test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:testId/round', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const testId = parseInt(req.params.testId, 10);
    const round = await getRound(userId, testId);
    res.json({ round });
  } catch (error) {
    console.error('Get round error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create test (admin only)
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const result = await testsDb.prepare(`
      INSERT INTO tests (name, description)
      VALUES (?, ?)
    `).run(name, description);
    
    res.json({ id: result.lastInsertRowid, name, description });
  } catch (error) {
    console.error('Create test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add step to test
router.post('/:id/steps', async (req, res) => {
  try {
    const { id } = req.params;
    const { step_number, description, success_symptom, value, on_failure } = req.body;
    
    const pointsVal = value || 0;
    const result = await testsDb.prepare(`
      INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, points, on_failure)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, step_number, description, success_symptom, pointsVal, pointsVal, on_failure || 'stop');
    
    res.json({ id: result.lastInsertRowid, test_id: parseInt(id), step_number, description, success_symptom, value: pointsVal, points: pointsVal, on_failure });
  } catch (error) {
    console.error('Add step error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update step
router.put('/:testId/steps/:stepId', async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const { step_number, description, success_symptom, value, on_failure } = req.body;
    const pointsVal = value || 0;

    await testsDb.prepare(`
      UPDATE test_steps SET step_number = ?, description = ?, success_symptom = ?, value = ?, points = ?, on_failure = ?
      WHERE id = ? AND test_id = ?
    `).run(step_number, description, success_symptom, pointsVal, pointsVal, on_failure, stepId, testId);

    res.json({ message: 'Step updated successfully' });
  } catch (error) {
    console.error('Update step error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete step
router.delete('/:testId/steps/:stepId', async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    
    await testsDb.prepare('DELETE FROM test_steps WHERE id = ? AND test_id = ?').run(stepId, testId);
    res.json({ message: 'Step deleted successfully' });
  } catch (error) {
    console.error('Delete step error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reorder steps
router.put('/:testId/steps/reorder', async (req, res) => {
  try {
    const { testId } = req.params;
    const { stepOrder } = req.body;
    
    const batch = stepOrder.map(({ id, step_number }) => ({
      sql: 'UPDATE test_steps SET step_number = ? WHERE id = ?',
      args: [step_number, id]
    }));
    await testsDb.client.batch(batch, 'write');
    
    res.json({ message: 'Steps reordered successfully' });
  } catch (error) {
    console.error('Reorder steps error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;