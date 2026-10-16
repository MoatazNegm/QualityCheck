const express = require('express');
const router = express.Router();
const { testsDb, usersDb, getRound, bumpRound, cache } = require('../db/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const { saveUploadedFile } = require('../utils/fileStorage');
const { getAppId, canUserAccessApp, getUserAssignedApps } = require('../utils/appContext');

async function getAssignedTestsOrdered(userId, appId = 1) {
  const cleanAppId = parseInt(appId, 10) || 1;
  return await testsDb.prepare(`
    SELECT t.* FROM tests t
    INNER JOIN test_assignments ta ON ta.test_id = t.id
    WHERE ta.user_id = ? AND t.app_id = ? AND COALESCE(t.is_deleted, 0) = 0
    ORDER BY t.id
  `).all(userId, cleanAppId);
}

async function getCurrentVersionId(appId = 1) {
  const cleanAppId = parseInt(appId, 10) || 1;
  const cacheKey = `currentVersionId:${cleanAppId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const row = await testsDb.prepare('SELECT id FROM versions WHERE is_current = 1 AND app_id = ? LIMIT 1').get(cleanAppId);
  const val = row ? row.id : null;
  cache.set(cacheKey, val);
  return val;
}

// Helper to determine if caller is authenticating via an API key (automated process / agent)
async function isAgentCaller(req, userId) {
  if (req && req.user) {
    if (req.user.isApiKey || req.user.apiKeyId) return true;
  }
  if (req && req.headers && (req.headers['x-api-key'] || req.headers['api-key'] || req.headers['x-api-token'])) {
    return true;
  }
  if (userId) {
    try {
      const keyRow = await testsDb.prepare('SELECT id FROM api_keys WHERE user_id = ? AND is_active = 1 LIMIT 1').get(userId);
      if (keyRow) return true;
    } catch (e) {}
  }
  return false;
}

// Configure uploads via memory storage so saveUploadedFile handles Dropbox/DB/disk
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

const uploadConfigFile = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }
  upload.fields([{ name: 'configFile', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Uploaded configuration file exceeds the 100MB size limit.' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    if (req.files) {
      req.file = req.files.configFile?.[0] || req.files.file?.[0] || null;
    }
    next();
  });
};

// Get next unattempted step for the logged-in user
router.get('/:testId/next', authenticateToken, async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.user.userId;

    const test = await testsDb.prepare('SELECT name, app_id FROM tests WHERE id = ?').get(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const testAppId = test.app_id || 1;
    const currentRound = await getRound(userId, testAppId);

    // If the test already failed with a hard stop in the current round, no more steps should be run
    const hardStopFail = await testsDb.prepare(`
      SELECT tr.step_id
      FROM test_results tr
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ? AND tr.test_id = ? AND COALESCE(tr.round_id, 0) = ?
        AND tr.result = 'fail' AND (ts.on_failure IS NULL OR ts.on_failure = 'stop')
      LIMIT 1
    `).get(userId, testId, currentRound);

    if (hardStopFail) {
      return res.status(404).json({ error: 'No more steps', allDone: true, failed: true });
    }

    const steps = await testsDb.prepare('SELECT * FROM test_steps WHERE test_id = ? ORDER BY step_number').all(testId);
    const attemptedRows = await testsDb.prepare(
      'SELECT step_id FROM test_results WHERE user_id = ? AND test_id = ? AND COALESCE(round_id, 0) = ?'
    ).all(userId, testId, currentRound);
    const attemptedStepIds = attemptedRows.map(row => row.step_id);

    const nextStep = steps.find(step => {
      const pts = Number(step.points ?? step.value ?? 0);
      return pts !== -1 && !attemptedStepIds.includes(step.id);
    });

    if (!nextStep) {
      return res.status(404).json({ error: 'No more steps', allDone: true });
    }

    res.json({
      step: nextStep,
      test_name: test.name,
      test_id: parseInt(testId, 10)
    });
  } catch (error) {
    console.error('Error fetching next step:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get next unattempted step for a user and test
router.get('/user/:userId/test/:testId/next', async (req, res) => {
  try {
    const { userId, testId } = req.params;
    
    // Get test name
    const test = await testsDb.prepare('SELECT name, app_id FROM tests WHERE id = ?').get(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    const testAppId = test.app_id || 1;
    const currentRound = await getRound(userId, testAppId);

    // If the test already failed with a hard stop in the current round, no more steps should be run
    const hardStopFail = await testsDb.prepare(`
      SELECT tr.step_id
      FROM test_results tr
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ? AND tr.test_id = ? AND COALESCE(tr.round_id, 0) = ?
        AND tr.result = 'fail' AND (ts.on_failure IS NULL OR ts.on_failure = 'stop')
      LIMIT 1
    `).get(userId, testId, currentRound);

    if (hardStopFail) {
      return res.status(404).json({ error: 'No more steps', allDone: true, failed: true });
    }

    // Get all steps ordered by step_number
    const steps = await testsDb.prepare('SELECT * FROM test_steps WHERE test_id = ? ORDER BY step_number').all(testId);
    
    // Get attempted step IDs in the current round
    const attemptedRows = await testsDb.prepare(
      'SELECT step_id FROM test_results WHERE user_id = ? AND test_id = ? AND COALESCE(round_id, 0) = ?'
    ).all(userId, testId, currentRound);
    const attemptedStepIds = attemptedRows.map(row => row.step_id);
    
    // Find first unattempted step (excluding section headers)
    const nextStep = steps.find(step => {
      const pts = Number(step.points ?? step.value ?? 0);
      return pts !== -1 && !attemptedStepIds.includes(step.id);
    });
    
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
router.get('/user/:userId/test/:testId', async (req, res) => {
  try {
    const { userId, testId } = req.params;
    
    const results = await testsDb.prepare(`
      SELECT tr.*, ts.description as step_description, ts.success_symptom, ts.value
      FROM test_results tr
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ? AND tr.test_id = ?
      ORDER BY tr.executed_at DESC
    `).all(userId, testId);
    
    res.json(results);
  } catch (error) {
    console.error('Error getting results:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit test result (userId from auth token)
router.post('/:testId/steps/:stepId', authenticateToken, uploadConfigFile, async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const userId = req.user.userId; // always from token or API key
    const { result, comment, fileData, fileName, configFileBase64, configFileName, configFilePath: providedFilePath } = req.body || {};

    let normalizedResult = String(result || '').trim().toLowerCase();
    if (['yes', 'y', 'pass', 'passed', 'true', '1'].includes(normalizedResult)) {
      normalizedResult = 'pass';
    } else if (['no', 'n', 'fail', 'failed', 'false', '0'].includes(normalizedResult)) {
      normalizedResult = 'fail';
    } else {
      return res.status(400).json({ error: "Result must be 'pass'/'fail' or 'yes'/'no'" });
    }

    const stepRow = await testsDb.prepare(
      'SELECT COALESCE(points, value, 0) AS pts, step_number, description, on_failure FROM test_steps WHERE id = ?'
    ).get(stepId);

    if (stepRow && Number(stepRow.pts) === -1) {
      return res.status(400).json({ error: 'Cannot submit results for a section header' });
    }

    const nowIso = new Date().toISOString();
    let configFilePath = providedFilePath || null;

    if (req.file) {
      const ext = path.extname(req.file.originalname) || '';
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const filename = `configFile-u${userId}-t${testId}-s${stepId}-${uniqueSuffix}${ext}`;
      try {
        const saved = await saveUploadedFile({
          fileBuffer: req.file.buffer,
          filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        });
        configFilePath = saved.filePath;
      } catch (uploadSaveErr) {
        console.error('Failed to save upload record:', uploadSaveErr);
      }
    } else if (fileData || configFileBase64) {
      try {
        const rawB64 = fileData || configFileBase64;
        const fileBuffer = Buffer.from(rawB64, 'base64');
        const origName = fileName || configFileName || 'attachment.bin';
        const ext = path.extname(origName) || '';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = `configFile-u${userId}-t${testId}-s${stepId}-${uniqueSuffix}${ext}`;
        const saved = await saveUploadedFile({
          fileBuffer,
          filename,
          originalName: origName,
          mimeType: req.body?.mimeType || 'application/octet-stream',
          size: fileBuffer.length
        });
        configFilePath = saved.filePath;
      } catch (uploadSaveErr) {
        console.error('Failed to save base64 upload record:', uploadSaveErr);
      }
    }

    // The app, version, and round this submission belongs to
    const testRow = await testsDb.prepare('SELECT app_id FROM tests WHERE id = ?').get(testId);
    if (!testRow) {
      return res.status(404).json({ error: 'Test not found' });
    }
    const appId = testRow.app_id || 1;
    if (!canUserAccessApp(req.user, appId)) {
      return res.status(403).json({ error: 'You do not have access to this application' });
    }

    const currentVersion = await testsDb.prepare('SELECT id FROM versions WHERE is_current = 1 AND app_id = ? LIMIT 1').get(appId);
    const currentVersionId = currentVersion ? currentVersion.id : null;

    // The unique loop-round this submission belongs to (per user per app cycle).
    const roundNo = await getRound(userId, appId);

    // Query preceding failed step submission before inserting the new submission
    const prevFailed = await testsDb.prepare(`
      SELECT ts.test_id, ts.step_id, ts.executed_at,
             t.name AS test_name,
             st.step_number, st.description AS step_description
      FROM test_submissions ts
      JOIN tests t ON ts.test_id = t.id
      JOIN test_steps st ON ts.step_id = st.id
      WHERE ts.user_id = ? AND ts.result = 'fail' AND (ts.app_id = ? OR ts.app_id IS NULL)
      ORDER BY ts.id DESC
      LIMIT 1
    `).get(userId, appId);

    // Append-only audit ledger: every submission gets its own row with a unique
    // id, so a re-failure of the same step in a later round is a distinct,
    // traceable record (result + comment + uploaded file + round_id + app_id).
    const subId = await testsDb.prepare(`
      INSERT INTO test_submissions (round_id, user_id, test_id, step_id, result, comment, config_file_path, version_id, executed_at, app_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(roundNo, userId, testId, stepId, normalizedResult, comment || null, configFilePath, currentVersionId, nowIso, appId);

    // Upsert: keep exactly ONE result row per (user, test, step) so the loop/next-step
    // logic and the per-step current view work. The full history lives in test_submissions.
    const prevResult = await testsDb.prepare(
      'SELECT config_file_path FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).get(userId, testId, stepId);

    await testsDb.prepare(
      'DELETE FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).run(userId, testId, stepId);

    const resultId = await testsDb.prepare(`
      INSERT INTO test_results (user_id, test_id, step_id, result, comment, config_file_path, version_id, round_id, executed_at, app_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, testId, stepId, normalizedResult, comment || null, configFilePath, currentVersionId, roundNo, nowIso, appId);

    // Append to the points ledger on every submission so points accumulate
    // across loop iterations (and for both pass and fail results). The loop's
    // current progress is tracked separately via the upserted test_results row.
    const stepPoints = stepRow ? (Number(stepRow.pts) || 0) : 0;

    let pointsAwarded = stepPoints;
    let warningCreated = null;

    // Cross-test consecutive failure rule check:
    // If the user fails a step and their preceding failed step was in another test
    // within the configured time threshold (default 3 minutes = 180 seconds),
    // 0 points are counted and a warning message is stored.
    // NOTE: Automated processes / agents calling via API key are exempt from point withholding/zeroing rules.
    const isAgent = await isAgentCaller(req, userId);
    if (!isAgent) {
      let thresholdSec = 180;
      const cachedSettings = cache.get('settings');
      if (cachedSettings && cachedSettings.consecutive_failure_threshold_seconds) {
        thresholdSec = parseInt(cachedSettings.consecutive_failure_threshold_seconds.value, 10) || 180;
      } else {
        const settingRow = await testsDb.prepare("SELECT value FROM settings WHERE key = 'consecutive_failure_threshold_seconds'").get();
        thresholdSec = settingRow ? (parseInt(settingRow.value, 10) || 180) : 180;
      }

      if (normalizedResult === 'fail' && prevFailed && prevFailed.test_id !== parseInt(testId, 10)) {
        const prevTimeMs = new Date(prevFailed.executed_at).getTime();
        const diffSec = (Date.now() - prevTimeMs) / 1000;
        if (diffSec >= 0 && diffSec <= thresholdSec) {
          pointsAwarded = 0;

          const currentTestRow = await testsDb.prepare('SELECT name FROM tests WHERE id = ?').get(testId);
          const curTestName = currentTestRow ? currentTestRow.name : `Test ${testId}`;
          const curStepNum = stepRow ? stepRow.step_number : stepId;
          const curStepDesc = stepRow ? stepRow.description : '';

          const prevTestName = prevFailed.test_name;
          const prevStepNum = prevFailed.step_number;
          const prevStepDesc = prevFailed.step_description;

          warningCreated = `The points for Step ${curStepNum} (${curStepDesc}) in test '${curTestName}' are not counted due to the user seems he depended on the preceding Step ${prevStepNum} (${prevStepDesc}) in test '${prevTestName}'.`;

          await testsDb.prepare(`
            INSERT INTO user_warnings (user_id, message, created_round, version_id, created_at, app_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(userId, warningCreated, roundNo, currentVersionId, nowIso, appId);
        }
      }
    }

    await testsDb.prepare(
      'INSERT INTO points_log (user_id, test_id, step_id, points, version_id, round_id, earned_at, app_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, testId, stepId, pointsAwarded, currentVersionId, roundNo, nowIso, appId);

    // Auto-end the test and advance the loop if:
    // 1. A hard-stop failure is submitted (on_failure === 'stop' or default 'stop')
    // 2. The current version differs from the version under which this test was started.
    let autoEnded = false;
    const stepOnFailure = stepRow ? (stepRow.on_failure || 'stop') : 'stop';
    const isHardStopFail = (normalizedResult === 'fail' && stepOnFailure === 'stop');

    const loopState = await testsDb.prepare('SELECT version_id FROM user_loop_state WHERE user_id = ? AND (app_id = ? OR app_id IS NULL)').get(userId, appId);
    const versionMismatch = loopState && loopState.version_id && currentVersionId && loopState.version_id !== currentVersionId;

    if (isHardStopFail || versionMismatch) {
      const assigned = await getAssignedTestsOrdered(userId, appId);
      if (assigned.length > 0) {
        const idx = assigned.findIndex(t => t.id === parseInt(testId, 10));
        const nextTest = assigned[(idx + 1) % assigned.length];
        await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, app_id, active_test_id, version_id) VALUES (?, ?, ?, ?)')
          .run(userId, appId, nextTest.id, currentVersionId);
        if (nextTest.id === assigned[0].id) {
          await bumpRound(userId, appId);
        }
        autoEnded = true;
      }
    }

    res.json({
      id: resultId.lastInsertRowid,
      submissionId: subId.lastInsertRowid,
      roundId: roundNo,
      result: normalizedResult,
      pointsAwarded,
      configFilePath,
      message: 'Result submitted successfully',
      autoEnded,
      warning: warningCreated
    });
  } catch (error) {
    console.error('Submit result error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get active rule warnings for the logged-in user (visible for 2 rounds)
router.get('/warnings', authenticateToken, async (req, res) => {
  try {
    const appId = getAppId(req);
    const userId = req.user.userId;
    const isAgent = await isAgentCaller(req, userId);
    if (isAgent) {
      return res.json({ warnings: [] });
    }
    const currentRound = await getRound(userId, appId);
    const warnings = await testsDb.prepare(`
      SELECT id, message, created_round, created_at
      FROM user_warnings
      WHERE user_id = ? AND (app_id = ? OR app_id IS NULL) AND (? - created_round) >= 0 AND (? - created_round) < 2
      ORDER BY id DESC
    `).all(userId, appId, currentRound, currentRound);
    res.json({ warnings });
  } catch (error) {
    console.error('Error fetching warnings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Revert results and points for a single step
router.delete('/:testId/steps/:stepId', authenticateToken, async (req, res) => {
  try {
    const { testId, stepId } = req.params;
    const testRow = await testsDb.prepare('SELECT app_id FROM tests WHERE id = ?').get(testId);
    const appId = testRow ? (testRow.app_id || 1) : 1;
    const userId = req.user.userId;
    const roundNo = await getRound(userId, appId);

    const prevResult = await testsDb.prepare(
      'SELECT config_file_path FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).get(userId, testId, stepId);

    // Delete from test_results
    await testsDb.prepare(
      'DELETE FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).run(userId, testId, stepId);

    // Delete from points_log
    await testsDb.prepare(
      'DELETE FROM points_log WHERE user_id = ? AND test_id = ? AND step_id = ? AND round_id = ?'
    ).run(userId, testId, stepId, roundNo);

    res.json({ message: 'Step result and points reverted successfully' });
  } catch (error) {
    console.error('Revert step result error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Clear all results for a user+test (restart)
router.delete('/user/:userId/test/:testId', authenticateToken, async (req, res) => {
  try {
    await testsDb.prepare(
      'DELETE FROM test_results WHERE user_id = ? AND test_id = ?'
    ).run(req.params.userId, req.params.testId);
    res.json({ message: 'Results cleared' });
  } catch (error) {
    console.error('Clear results error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Points summary for the logged-in user: total points earned this month for active app
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const appId = getAppId(req);
    const userId = req.user.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const monthStartStr = `${monthStart.getFullYear()}-${pad(monthStart.getMonth() + 1)}-${pad(monthStart.getDate())} ${pad(monthStart.getHours())}:${pad(monthStart.getMinutes())}:${pad(monthStart.getSeconds())}`;

    const row = await testsDb.prepare(`
      SELECT COALESCE(SUM(pl.points), 0) AS earned
      FROM points_log pl
      JOIN tests t ON pl.test_id = t.id
      WHERE pl.user_id = ? AND pl.earned_at >= ? AND (t.app_id = ? OR t.app_id IS NULL)
    `).get(userId, monthStartStr, appId);

    res.json({ monthEarned: row ? row.earned : 0, monthStart: monthStartStr });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all results for current authenticated user
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const results = await testsDb.prepare(`
      SELECT tr.*, t.name as test_name, ts.step_number, ts.description as step_description
      FROM test_results tr
      JOIN tests t ON tr.test_id = t.id
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ?
      ORDER BY tr.executed_at DESC
    `).all(userId);
    res.json(results);
  } catch (error) {
    console.error('Get my results error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all results for user (for reporting)
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const results = await testsDb.prepare(`
      SELECT tr.*, t.name as test_name, ts.step_number, ts.description as step_description
      FROM test_results tr
      JOIN tests t ON tr.test_id = t.id
      JOIN test_steps ts ON tr.step_id = ts.id
      WHERE tr.user_id = ?
      ORDER BY tr.executed_at DESC
    `).all(userId);
    
    res.json(results);
  } catch (error) {
    console.error('Get user results error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;