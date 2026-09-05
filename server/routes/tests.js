const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { testsDb, bumpRound, getRound, cache } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { saveUploadedFile } = require('../utils/fileStorage');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const uploadStepAttachment = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Uploaded file exceeds the 100MB size limit.' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
};

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
  const cached = cache.get('currentVersionId');
  if (cached !== undefined) return cached;
  const row = await testsDb.prepare('SELECT id FROM versions WHERE is_current = 1 LIMIT 1').get();
  const val = row ? row.id : null;
  cache.set('currentVersionId', val);
  return val;
}

// Get maximum allowed monthly test rounds setting (default 8)
async function getMaxMonthlyTestRounds() {
  const cached = cache.get('settings');
  if (cached && cached.max_monthly_test_rounds) {
    return parseInt(cached.max_monthly_test_rounds.value, 10) || 8;
  }
  const row = await testsDb.prepare("SELECT value FROM settings WHERE key = 'max_monthly_test_rounds'").get();
  return row ? (parseInt(row.value, 10) || 8) : 8;
}

// Count distinct rounds for a specific test and user in the current calendar month where at least half the steps were completed
async function getTestMonthlyRounds(userId, testId) {
  const distinctRow = await testsDb.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT r_id FROM (
        SELECT round_id AS r_id, step_id FROM test_submissions WHERE user_id = ? AND test_id = ? AND strftime('%Y-%m', executed_at) = strftime('%Y-%m', 'now')
        UNION
        SELECT round_id AS r_id, step_id FROM test_results WHERE user_id = ? AND test_id = ? AND strftime('%Y-%m', executed_at) = strftime('%Y-%m', 'now')
      )
      GROUP BY r_id
      HAVING (SELECT COUNT(*) FROM test_steps WHERE test_id = ? AND COALESCE(points, value, 0) != -1) > 0
         AND COUNT(DISTINCT step_id) * 2 >= (SELECT COUNT(*) FROM test_steps WHERE test_id = ? AND COALESCE(points, value, 0) != -1)
    )
  `).get(userId, testId, userId, testId, testId, testId);

  return distinctRow ? (distinctRow.c || 0) : 0;
}

// Batch: get monthly rounds for multiple tests at once (eliminates N+1)
// Only rounds where the user made at least half the steps are counted towards the limit.
async function getBatchMonthlyRounds(userId, testIds) {
  if (testIds.length === 0) return {};
  const placeholders = testIds.map(() => '?').join(',');
  const rows = await testsDb.prepare(`
    SELECT test_id, COUNT(*) AS c FROM (
      SELECT u.test_id, u.r_id FROM (
        SELECT test_id, round_id AS r_id, step_id FROM test_submissions WHERE user_id = ? AND test_id IN (${placeholders}) AND strftime('%Y-%m', executed_at) = strftime('%Y-%m', 'now')
        UNION
        SELECT test_id, round_id AS r_id, step_id FROM test_results WHERE user_id = ? AND test_id IN (${placeholders}) AND strftime('%Y-%m', executed_at) = strftime('%Y-%m', 'now')
      ) u
      JOIN (
        SELECT test_id, COUNT(*) AS total_steps FROM test_steps WHERE test_id IN (${placeholders}) AND COALESCE(points, value, 0) != -1 GROUP BY test_id
      ) s ON s.test_id = u.test_id
      GROUP BY u.test_id, u.r_id
      HAVING s.total_steps > 0 AND COUNT(DISTINCT u.step_id) * 2 >= s.total_steps
    ) GROUP BY test_id
  `).all(userId, ...testIds, userId, ...testIds, ...testIds);
  const map = {};
  for (const r of rows) map[r.test_id] = r.c || 0;
  return map;
}

// Returns the currently active (unlocked) test id for a user, skipping monthly-locked tests, 
// and automatically skipping tests that were already completed or hard-failed in the current round.
async function getActiveTestId(userId) {
  const assigned = await getAssignedTestsOrdered(userId);
  if (assigned.length === 0) return null;

  const maxRounds = await getMaxMonthlyTestRounds();
  const testIds = assigned.map(t => t.id);
  
  const monthlyRoundsMap = await getBatchMonthlyRounds(userId, testIds);
  const currentRound = await getRound(userId);
  const completionMap = await getBatchCompletionCounts(userId, testIds, currentRound);
  const stepCountsMap = await getBatchStepCounts(testIds);

  const failRows = await testsDb.prepare(`
    SELECT DISTINCT ts.test_id 
    FROM test_results tr
    JOIN test_steps ts ON tr.step_id = ts.id
    WHERE tr.user_id = ? AND tr.round_id = ? AND tr.result = 'fail' AND (ts.on_failure IS NULL OR ts.on_failure = 'stop')
  `).all(userId, currentRound);
  
  const hardStopMap = {};
  for (const r of failRows) hardStopMap[r.test_id] = true;
  
  const availableAssigned = assigned.filter(t => {
    // 1. Skip if they reached the monthly limit
    if ((monthlyRoundsMap[t.id] || 0) >= maxRounds) return false;
    // 2. Skip if they hard-failed this test in the current round
    if (hardStopMap[t.id]) return false;
    // 3. Skip if they fully completed this test in the current round
    const isCompleted = stepCountsMap[t.id] > 0 && (completionMap[t.id] || 0) >= stepCountsMap[t.id];
    if (isCompleted) return false;
    return true;
  });
  
  if (availableAssigned.length === 0) {
    // Check if they are completely locked out due to monthly limits
    const allTestsMonthlyLocked = assigned.every(t => (monthlyRoundsMap[t.id] || 0) >= maxRounds);
    if (allTestsMonthlyLocked) {
      return null; // Truly locked out for the month
    }

    // Otherwise, they finished or failed ALL tests in the CURRENT round, but the round was never bumped!
    // (e.g. they closed the browser on the last test before it could auto-advance).
    // We auto-bump the round for them and restart the loop!
    await bumpRound(userId);
    
    const currentVersionId = await getCurrentVersionId();
    const firstCandidate = assigned[0];
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, firstCandidate.id, currentVersionId);
    
    return firstCandidate.id;
  }

  const currentVersionId = await getCurrentVersionId();
  const row = await testsDb.prepare('SELECT active_test_id, version_id FROM user_loop_state WHERE user_id = ?').get(userId);

  if (row) {
    const isValidAndAvailable = availableAssigned.some(t => t.id === row.active_test_id);
    
    if (!isValidAndAvailable) {
      const oldIdx = assigned.findIndex(t => t.id === row.active_test_id);
      let candidate = availableAssigned[0];
      if (oldIdx !== -1) {
        const after = availableAssigned.find(t => t.id > row.active_test_id);
        if (after) candidate = after;
      }
      await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
        .run(userId, candidate.id, currentVersionId);
      return candidate.id;
    }

    if (row.version_id && currentVersionId && row.version_id !== currentVersionId) {
      const idx = availableAssigned.findIndex(t => t.id === row.active_test_id);
      const nextTest = availableAssigned[(idx + 1) % availableAssigned.length];
      await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
        .run(userId, nextTest.id, currentVersionId);
      return nextTest.id;
    }

    return row.active_test_id;
  }

  const firstCandidate = availableAssigned[0];
  await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
    .run(userId, firstCandidate.id, currentVersionId);
  return firstCandidate.id;
}

// Whether every step of a test has a recorded result for the user in the given round
async function isTestCompleted(userId, testId, roundNo) {
  const stepCountRow = await testsDb.prepare('SELECT COUNT(*) AS c FROM test_steps WHERE test_id = ? AND COALESCE(points, value, 0) != -1').get(testId);
  const stepCount = stepCountRow ? stepCountRow.c : 0;
  if (stepCount === 0) return false;

  const doneCountRow = await testsDb.prepare(
    `SELECT COUNT(DISTINCT tr.step_id) AS c
     FROM test_results tr
     JOIN test_steps ts ON ts.id = tr.step_id
     WHERE tr.user_id = ? AND tr.test_id = ? AND tr.round_id = ? AND COALESCE(ts.points, ts.value, 0) != -1`
  ).get(userId, testId, roundNo);
  const doneCount = doneCountRow ? doneCountRow.c : 0;

  return doneCount >= stepCount;
}

// Batch: get completion counts for multiple tests at once (eliminates N+1)
async function getBatchCompletionCounts(userId, testIds, roundNo) {
  if (testIds.length === 0) return {};
  const placeholders = testIds.map(() => '?').join(',');
  const rows = await testsDb.prepare(`
    SELECT tr.test_id, COUNT(DISTINCT tr.step_id) AS c
    FROM test_results tr
    JOIN test_steps ts ON ts.id = tr.step_id
    WHERE tr.user_id = ? AND tr.test_id IN (${placeholders}) AND tr.round_id = ? AND COALESCE(ts.points, ts.value, 0) != -1
    GROUP BY tr.test_id
  `).all(userId, ...testIds, roundNo);
  const map = {};
  for (const r of rows) map[r.test_id] = r.c || 0;
  return map;
}

// Batch: get step counts per test (cached)
async function getBatchStepCounts(testIds) {
  const result = {};
  const uncached = [];
  for (const id of testIds) {
    const cached = cache.get(`stepCount:${id}`);
    if (cached !== undefined) {
      result[id] = cached;
    } else {
      uncached.push(id);
    }
  }
  if (uncached.length > 0) {
    const placeholders = uncached.map(() => '?').join(',');
    const rows = await testsDb.prepare(
      `SELECT test_id, COUNT(*) AS c FROM test_steps WHERE test_id IN (${placeholders}) AND COALESCE(points, value, 0) != -1 GROUP BY test_id`
    ).all(...uncached);
    for (const r of rows) {
      result[r.test_id] = r.c;
      cache.set(`stepCount:${r.test_id}`, r.c);
    }
    // Tests with no steps
    for (const id of uncached) {
      if (result[id] === undefined) {
        result[id] = 0;
        cache.set(`stepCount:${id}`, 0);
      }
    }
  }
  return result;
}

// Total points awarded for a test (sum of its steps' points, excluding section headers)
async function getTestTotalPoints(testId) {
  const cacheKey = `totalPoints:${testId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const row = await testsDb.prepare(
    'SELECT COALESCE(SUM(CASE WHEN COALESCE(points, value, 0) > 0 THEN COALESCE(points, value, 0) ELSE 0 END), 0) AS total FROM test_steps WHERE test_id = ?'
  ).get(testId);
  const val = row ? row.total : 0;
  cache.set(cacheKey, val);
  return val;
}

// Get all tests (filtered by assignment for non-admins without developer access, with loop lock status)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const groups = req.user.userGroups || [];
    const isFullAccess = req.user.isAdmin || groups.includes('developers') || groups.includes('admins');
    let tests;
    if (isFullAccess) {
      const allTests = await testsDb.prepare('SELECT * FROM tests ORDER BY id').all();
      tests = await Promise.all(allTests.map(async t => ({
        ...t,
        locked: false,
        isActive: false,
        completed: false,
        totalPoints: await getTestTotalPoints(t.id),
        monthlyRounds: 0,
        maxMonthlyRounds: 8,
        isMonthlyLocked: false
      })));
    } else {
      const maxRounds = await getMaxMonthlyTestRounds();
      const assigned = await getAssignedTestsOrdered(req.user.userId);
      const testIds = assigned.map(t => t.id);

      // Batch queries instead of N+1 loops
      const monthlyRoundsMap = await getBatchMonthlyRounds(req.user.userId, testIds);
      const currentRound = await getRound(req.user.userId);
      const completionMap = await getBatchCompletionCounts(req.user.userId, testIds, currentRound);
      const stepCountsMap = await getBatchStepCounts(testIds);

      // Determine active test using pre-fetched monthly rounds
      const availableAssigned = assigned.filter(t => (monthlyRoundsMap[t.id] || 0) < maxRounds);
      let activeTestId = null;
      if (availableAssigned.length > 0) {
        // Use getActiveTestId which now also uses batch internally
        activeTestId = await getActiveTestId(req.user.userId);
      }

      tests = await Promise.all(assigned.map(async t => {
        const mRounds = monthlyRoundsMap[t.id] || 0;
        const isMonthlyLocked = mRounds >= maxRounds;
        const isLocked = isMonthlyLocked || (t.id !== activeTestId);
        const isActive = !isMonthlyLocked && (t.id === activeTestId);
        const stepCount = stepCountsMap[t.id] || 0;
        const doneCount = completionMap[t.id] || 0;
        return {
          ...t,
          locked: isLocked,
          isActive: isActive,
          completed: stepCount > 0 && doneCount >= stepCount,
          totalPoints: await getTestTotalPoints(t.id),
          monthlyRounds: mRounds,
          maxMonthlyRounds: maxRounds,
          isMonthlyLocked: isMonthlyLocked
        };
      }));
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

    const currentRound = await getRound(userId);
    if (!(await isTestCompleted(userId, testId, currentRound))) {
      return res.status(400).json({ error: 'Cannot complete an unfinished test' });
    }

    const currentVersionId = await getCurrentVersionId();
    const idx = assigned.findIndex(t => t.id === testId);
    const candidateNext = assigned[(idx + 1) % assigned.length];
    
    // Tentatively update loop state to candidateNext
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, candidateNext.id, currentVersionId);
    if (candidateNext.id === assigned[0].id) {
      await bumpRound(userId);
    }

    // Evaluate active test ID considering monthly round limits
    const nextActiveId = await getActiveTestId(userId);

    res.json({ message: 'Test completed', active_test_id: nextActiveId });
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

    const maxRounds = await getMaxMonthlyTestRounds();
    const mRounds = await getTestMonthlyRounds(userId, testId);
    if (mRounds >= maxRounds) {
      return res.status(400).json({ error: 'This test has reached its maximum monthly round limit.' });
    }

    const activeTestId = await getActiveTestId(userId);
    const currentRound = await getRound(userId);
    if (activeTestId !== testId && !(await isTestCompleted(userId, testId, currentRound))) {
      return res.status(400).json({ error: 'Can only re-open the current or a completed test' });
    }

    const currentVersionId = await getCurrentVersionId();
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, testId, currentVersionId);

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
    const candidateNext = assigned[(idx + 1) % assigned.length];
    await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
      .run(userId, candidateNext.id, currentVersionId);
    if (candidateNext.id === assigned[0].id) {
      await bumpRound(userId);
    }

    const nextActiveId = await getActiveTestId(userId);

    res.json({ message: 'Test ended', active_test_id: nextActiveId });
  } catch (error) {
    console.error('End test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

function isNumericValue(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') return !isNaN(val);
  const str = String(val).trim();
  if (!str) return false;
  return /^-?\d+(\.\d+)?$/.test(str);
}

function parsePoints(val) {
  if (val === undefined || val === null || String(val).trim() === '') return 10;
  const parsed = parseInt(String(val).trim(), 10);
  return isNaN(parsed) ? 10 : parsed;
}

function isHeaderRow(row0, row1) {
  if (!Array.isArray(row0) || row0.length === 0) return false;
  // If row0 col 0 is a number, row0 cannot be a header
  if (isNumericValue(row0[0])) return false;

  // If row1 exists and row1 col 0 is a number, but row0 col 0 is not, row0 is definitely a header
  if (row1 && isNumericValue(row1[0])) return true;

  // If row0's points column (or last column) is already a number, row0 cannot be a header
  const row0LastIdx = row0.length - 1;
  if (isNumericValue(row0[row0LastIdx])) return false;

  // Otherwise, if row1 exists and row1's last column IS numeric, row0 has 'Points' label text -> row0 is header
  if (row1) {
    const row1LastIdx = row1.length - 1;
    if (isNumericValue(row1[row1LastIdx])) return true;
  }

  // Check common header keywords
  return row0.some(c => /^(step|desc|symptom|expect|point|score|value|case|result|test|#|no)/i.test(String(c).trim()));
}

// Import tests from Excel or CSV file (admin only)
router.post('/import', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const imported = [];

    const rawFileName = req.body.fileName || req.file.originalname || 'import';
    const baseName = rawFileName.replace(/\.[^/.]+$/, '');

    const tx = await testsDb.client.transaction('write');
    try {
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        const rows = rawRows.filter(r => Array.isArray(r) && r.some(c => String(c ?? '').trim() !== ''));
        if (rows.length === 0) continue;

        let dataRows = rows;
        if (rows.length > 0) {
          const row0 = rows[0];
          const row1 = rows.length > 1 ? rows[1] : null;
          if (isHeaderRow(row0, row1)) {
            dataRows = rows.slice(1);
          }
        }

        if (dataRows.length === 0) continue;

        // Determine whether column 0 in dataRows contains numbers or words
        const numericCol0Count = dataRows.filter(r => isNumericValue(r[0])).length;
        const col0IsNumbers = numericCol0Count > 0 && numericCol0Count >= dataRows.length * 0.5;

        const testName = workbook.SheetNames.length === 1 ? baseName : `${baseName} - ${sheetName}`;

        const result = await tx.execute({
          sql: 'INSERT INTO tests (name, description) VALUES (?, ?)',
          args: [testName, 'Imported from file']
        });
        const testId = Number(result.lastInsertRowid);

        let autoStepNumber = 1;
        for (const row of dataRows) {
          let stepNumber;
          let description;
          let successSymptom;
          let points;

          if (col0IsNumbers) {
            // 4 columns: [step_number, description, success_symptom, points]
            const rawNum = parseInt(String(row[0]).trim(), 10);
            stepNumber = !isNaN(rawNum) && rawNum > 0 ? rawNum : autoStepNumber;
            description = String(row[1] || '').trim();
            successSymptom = String(row[2] || '').trim() || 'N/A';
            points = parsePoints(row[3]);
          } else {
            // 3 columns: [description, success_symptom, points], auto-numbered
            stepNumber = autoStepNumber;
            description = String(row[0] || '').trim();
            successSymptom = String(row[1] || '').trim() || 'N/A';
            points = parsePoints(row[2]);
          }

          if (!description) continue;

          await tx.execute({
            sql: `INSERT INTO test_steps (test_id, step_number, description, success_symptom, on_failure, points, value)
                  VALUES (?, ?, ?, ?, 'stop', ?, ?)`,
            args: [testId, stepNumber, description, successSymptom, points, points]
          });
          autoStepNumber++;
        }

        imported.push({ id: testId, name: testName, stepsCount: autoStepNumber - 1 });
      }
      await tx.commit();
      cache.invalidatePrefix('stepCount:');
      cache.invalidatePrefix('totalPoints:');
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    res.json({ imported });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import Excel or CSV file' });
  }
});

// Rename test (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Test name is required' });
    }
    await testsDb.prepare('UPDATE tests SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
    res.json({ message: 'Test renamed successfully' });
  } catch (error) {
    console.error('Rename test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk: get all test assignments grouped by test (admin only) — replaces N+1 frontend loop
router.get('/assignments/bulk', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await testsDb.prepare('SELECT test_id, user_id FROM test_assignments').all();
    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.test_id]) grouped[r.test_id] = [];
      grouped[r.test_id].push(r.user_id);
    }
    res.json(grouped);
  } catch (error) {
    console.error('Bulk assignments error:', error);
    res.status(500).json({ error: 'Server error' });
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

// Get all test IDs assigned to a user (admin only)
router.get('/user/:userId/assignments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const assignments = await testsDb.prepare(`
      SELECT test_id FROM test_assignments WHERE user_id = ?
    `).all(req.params.userId);
    res.json(assignments.map(a => a.test_id));
  } catch (error) {
    console.error('Get user assignments error:', error);
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
    if (isNaN(points) || points < -1) {
      return res.status(400).json({ error: 'Points must be at least -1 (-1 for section headers)' });
    }
    await testsDb.prepare('UPDATE test_steps SET points = ?, value = ? WHERE id = ? AND test_id = ?')
      .run(points, points, req.params.stepId, req.params.testId);
    cache.invalidate('totalPoints:' + req.params.testId);
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

router.get('/steps', authenticateToken, async (req, res) => {
  try {
    const testIdsRaw = req.query.testIds;
    let testIds = [];
    let tests;

    if (testIdsRaw === 'all' || !testIdsRaw) {
      tests = await testsDb.prepare('SELECT id, name FROM tests ORDER BY id').all();
      testIds = tests.map(t => t.id);
    } else {
      testIds = String(testIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));

      if (testIds.length === 0) {
        return res.status(400).json({ error: 'At least one valid testId is required' });
      }

      const placeholders = testIds.map(() => '?').join(',');
      tests = await testsDb.prepare(`SELECT id, name FROM tests WHERE id IN (${placeholders})`).all(...testIds);
    }

    if (tests.length === 0) {
      return res.status(404).json({ error: 'No valid tests found' });
    }

    const testPlaceholders = testIds.map(() => '?').join(',');
    const steps = await testsDb.prepare(
      `SELECT test_id, id, step_number, description, success_symptom,
              COALESCE(points, value, 0) AS points,
              COALESCE(value, points, 0) AS value,
              COALESCE(on_failure, 'stop') AS on_failure,
              attachment_path, attachment_name
       FROM test_steps
       WHERE test_id IN (${testPlaceholders})
       ORDER BY test_id, step_number`
    ).all(...testIds);

    const stepsByTest = {};
    for (const step of steps) {
      if (!stepsByTest[step.test_id]) stepsByTest[step.test_id] = [];
      stepsByTest[step.test_id].push({
        id: step.id,
        test_id: step.test_id,
        step_number: step.step_number,
        description: step.description,
        success_symptom: (step.success_symptom && step.success_symptom.trim()) ? step.success_symptom.trim() : 'N/A',
        points: isNaN(Number(step.points)) ? 0 : Number(step.points),
        value: isNaN(Number(step.value)) ? 0 : Number(step.value),
        on_failure: step.on_failure || 'stop',
        attachment_path: step.attachment_path || null,
        attachment_name: step.attachment_name || null
      });
    }

    const result = tests.map(t => ({
      testId: t.id,
      testName: t.name,
      steps: stepsByTest[t.id] || []
    }));

    res.json(result);
  } catch (error) {
    console.error('Get test steps error:', error);
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
      `SELECT id, test_id, step_number, description, success_symptom,
              COALESCE(points, value, 0) AS points,
              COALESCE(value, points, 0) AS value,
              COALESCE(on_failure, 'stop') AS on_failure,
              attachment_path, attachment_name
       FROM test_steps
       WHERE test_id = ?
       ORDER BY step_number`
    ).all(req.params.id);
    
    test.steps = steps.map(s => ({
      ...s,
      success_symptom: (s.success_symptom && s.success_symptom.trim()) ? s.success_symptom.trim() : 'N/A',
      points: isNaN(Number(s.points)) ? 0 : Number(s.points),
      value: isNaN(Number(s.value)) ? 0 : Number(s.value),
      on_failure: s.on_failure || 'stop',
      attachment_path: s.attachment_path || null,
      attachment_name: s.attachment_name || null
    }));
    res.json(test);
  } catch (error) {
    console.error('Get test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:testId/round', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const round = await getRound(userId);
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
    const { step_number, description, success_symptom, value, points, on_failure, attachment_path, attachment_name } = req.body;
    
    const pointsVal = points !== undefined ? Number(points) : (value !== undefined ? Number(value) : 0);
    const successVal = (success_symptom !== undefined && success_symptom !== null && String(success_symptom).trim()) ? String(success_symptom).trim() : 'N/A';
    const result = await testsDb.prepare(`
      INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, points, on_failure, attachment_path, attachment_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, step_number, description, successVal, pointsVal, pointsVal, on_failure || 'stop', attachment_path || null, attachment_name || null);
    
    cache.invalidate('stepCount:' + id);
    cache.invalidate('totalPoints:' + id);
    res.json({ id: result.lastInsertRowid, test_id: parseInt(id), step_number, description, success_symptom: successVal, value: pointsVal, points: pointsVal, on_failure: on_failure || 'stop', attachment_path: attachment_path || null, attachment_name: attachment_name || null });
  } catch (error) {
    console.error('Add step error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update step
router.put('/:testId/steps/:stepId', async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const { step_number, description, success_symptom, value, points, on_failure, attachment_path, attachment_name } = req.body;
    const pointsVal = points !== undefined ? Number(points) : (value !== undefined ? Number(value) : 0);
    const successVal = (success_symptom !== undefined && success_symptom !== null && String(success_symptom).trim()) ? String(success_symptom).trim() : 'N/A';

    if (attachment_path !== undefined || attachment_name !== undefined) {
      await testsDb.prepare(`
        UPDATE test_steps SET step_number = ?, description = ?, success_symptom = ?, value = ?, points = ?, on_failure = ?, attachment_path = ?, attachment_name = ?
        WHERE id = ? AND test_id = ?
      `).run(step_number, description, successVal, pointsVal, pointsVal, on_failure || 'stop', attachment_path || null, attachment_name || null, stepId, testId);
    } else {
      await testsDb.prepare(`
        UPDATE test_steps SET step_number = ?, description = ?, success_symptom = ?, value = ?, points = ?, on_failure = ?
        WHERE id = ? AND test_id = ?
      `).run(step_number, description, successVal, pointsVal, pointsVal, on_failure || 'stop', stepId, testId);
    }

    cache.invalidate('totalPoints:' + testId);
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
    cache.invalidate('stepCount:' + testId);
    cache.invalidate('totalPoints:' + testId);
    res.json({ message: 'Step deleted successfully' });
  } catch (error) {
    console.error('Delete step error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload reference attachment for a step (admin only)
router.post('/:testId/steps/:stepId/attachment', authenticateToken, requireAdmin, uploadStepAttachment, async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const step = await testsDb.prepare('SELECT id FROM test_steps WHERE id = ? AND test_id = ?').get(stepId, testId);
    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    const ext = path.extname(req.file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = `stepRef-t${testId}-s${stepId}-${uniqueSuffix}${ext}`;

    const saved = await saveUploadedFile({
      fileBuffer: req.file.buffer,
      filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    });

    await testsDb.prepare(`
      UPDATE test_steps SET attachment_path = ?, attachment_name = ? WHERE id = ? AND test_id = ?
    `).run(saved.filePath, saved.originalName, stepId, testId);

    res.json({
      attachment_path: saved.filePath,
      attachment_name: saved.originalName
    });
  } catch (error) {
    console.error('Upload step attachment error:', error);
    res.status(500).json({ error: 'Failed to upload step attachment' });
  }
});

// Delete reference attachment from a step (admin only)
router.delete('/:testId/steps/:stepId/attachment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const step = await testsDb.prepare('SELECT id FROM test_steps WHERE id = ? AND test_id = ?').get(stepId, testId);
    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    await testsDb.prepare(`
      UPDATE test_steps SET attachment_path = NULL, attachment_name = NULL WHERE id = ? AND test_id = ?
    `).run(stepId, testId);

    res.json({ message: 'Attachment removed successfully' });
  } catch (error) {
    console.error('Delete step attachment error:', error);
    res.status(500).json({ error: 'Failed to remove step attachment' });
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