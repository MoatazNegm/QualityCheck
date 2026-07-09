const express = require('express');
const router = express.Router();
const { testsDb, usersDb, getRound, bumpRound } = require('../db/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

function getAssignedTestsOrdered(userId) {
  return testsDb.prepare(`
    SELECT t.* FROM tests t
    INNER JOIN test_assignments ta ON ta.test_id = t.id
    WHERE ta.user_id = ?
    ORDER BY t.id
  `).all(userId);
}

function getCurrentVersionId() {
  const row = testsDb.prepare('SELECT id FROM versions WHERE is_current = 1 LIMIT 1').get();
  return row ? row.id : null;
}

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
    // Embed the user/test/step ids so every saved file is unambiguously related
    // to the exact failed step it was submitted for, plus a timestamp+random
    // suffix so a re-failure in a later loop round is always a distinct file.
    const userId = req.user && req.user.userId ? req.user.userId : 'anon';
    const testId = req.params && req.params.testId ? req.params.testId : 't';
    const stepId = req.params && req.params.stepId ? req.params.stepId : 's';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `configFile-u${userId}-t${testId}-s${stepId}-${uniqueSuffix}${ext}`);
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

// Submit test result (userId from auth token)
router.post('/:testId/steps/:stepId', authenticateToken, upload.single('configFile'), async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const userId = req.user.userId; // always from JWT — never trust client-supplied userId
    const { result, comment } = req.body;

    if (!result || !['pass', 'fail'].includes(result)) {
      return res.status(400).json({ error: 'Result must be pass or fail' });
    }

    let configFilePath = null;
    if (req.file) {
      configFilePath = `/uploads/${req.file.filename}`;
    }

    // The version the user is currently running. Every submission is tagged with
    // it so pass/fail, points, and "# tests done" can later be reported per version.
    const currentVersion = testsDb.prepare('SELECT id FROM versions WHERE is_current = 1 LIMIT 1').get();
    const currentVersionId = currentVersion ? currentVersion.id : null;

    // The unique loop-round this submission belongs to (per user+test).
    const roundNo = getRound(userId, testId);

    // Append-only audit ledger: every submission gets its own row with a unique
    // id, so a re-failure of the same step in a later round is a distinct,
    // traceable record (result + comment + uploaded file + round_id).
    const subId = testsDb.prepare(`
      INSERT INTO test_submissions (round_id, user_id, test_id, step_id, result, comment, config_file_path, version_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(roundNo, userId, testId, stepId, result, comment || null, configFilePath, currentVersionId);

    // Upsert: keep exactly ONE result row per (user, test, step) so the loop/next-step
    // logic and the per-step current view work. Capture the previously saved file so
    // we can delete it from disk once the new upload replaces it — this guarantees a
    // later-round re-failure points at a brand-new, distinct file and we never confuse
    // it with an older submission. The full history lives in test_submissions.
    const prevResult = testsDb.prepare(
      'SELECT config_file_path FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).get(userId, testId, stepId);

    testsDb.prepare(
      'DELETE FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).run(userId, testId, stepId);

    const resultId = testsDb.prepare(`
      INSERT INTO test_results (user_id, test_id, step_id, result, comment, config_file_path, version_id, round_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, testId, stepId, result, comment || null, configFilePath, currentVersionId, roundNo);

    // Remove the now-orphaned previous upload for this step (it can no longer be
    // referenced, so leaving it would only create stale/confusing duplicates).
    if (prevResult && prevResult.config_file_path && prevResult.config_file_path !== configFilePath) {
      const oldAbs = path.join(uploadDir, path.basename(prevResult.config_file_path));
      if (fs.existsSync(oldAbs)) {
        try { fs.unlinkSync(oldAbs); } catch (e) { console.error('Failed to delete old upload', oldAbs, e); }
      }
    }

    // Append to the points ledger on every submission so points accumulate
    // across loop iterations (and for both pass and fail results). The loop's
    // current progress is tracked separately via the upserted test_results row.
    const stepRow = testsDb.prepare(
      'SELECT COALESCE(points, value, 0) AS pts FROM test_steps WHERE id = ?'
    ).get(stepId);
    const stepPoints = stepRow ? (Number(stepRow.pts) || 0) : 0;
    testsDb.prepare(
      'INSERT INTO points_log (user_id, test_id, step_id, points, version_id, round_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, testId, stepId, stepPoints, currentVersionId, roundNo);

    // If the current version differs from the version this test was started under,
    // auto-end the test and advance to the next one (new round for that test).
    let autoEnded = false;
    const loopState = testsDb.prepare('SELECT version_id FROM user_loop_state WHERE user_id = ?').get(userId);
    if (loopState && loopState.version_id && currentVersionId && loopState.version_id !== currentVersionId) {
      const assigned = getAssignedTestsOrdered(userId);
      if (assigned.length > 0) {
        const idx = assigned.findIndex(t => t.id === parseInt(testId, 10));
        const nextTest = assigned[(idx + 1) % assigned.length];
        testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
          .run(userId, nextTest.id, currentVersionId);
        bumpRound(userId, nextTest.id);
        autoEnded = true;
      }
    }

    res.json({ id: resultId.lastInsertRowid, submissionId: subId.lastInsertRowid, roundId: roundNo, message: 'Result submitted successfully', autoEnded });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Clear all results for a user+test (restart)
router.delete('/user/:userId/test/:testId', authenticateToken, (req, res) => {
  try {
    testsDb.prepare(
      'DELETE FROM test_results WHERE user_id = ? AND test_id = ?'
    ).run(req.params.userId, req.params.testId);
    res.json({ message: 'Results cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Points summary for the logged-in user: total points earned this month
// (sum of the points ledger for every step submitted since the 1st of the
// current month). The ledger grows on every submission — including re-runs of
// the loop and failed steps — so points accumulate rather than freeze.
router.get('/summary', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const monthStartStr = `${monthStart.getFullYear()}-${pad(monthStart.getMonth() + 1)}-${pad(monthStart.getDate())} ${pad(monthStart.getHours())}:${pad(monthStart.getMinutes())}:${pad(monthStart.getSeconds())}`;

    const row = testsDb.prepare(`
      SELECT COALESCE(SUM(points), 0) AS earned
      FROM points_log
      WHERE user_id = ? AND earned_at >= ?
    `).get(userId, monthStartStr);

    res.json({ monthEarned: row.earned, monthStart: monthStartStr });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all results for user (for reporting)
router.get('/user/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    const results = testsDb.prepare(`
      SELECT tr.*, t.name as test_name, ts.step_number, ts.description as step_description
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