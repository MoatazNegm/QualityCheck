const express = require('express');
const router = express.Router();
const { testsDb, usersDb, getRound, bumpRound, cache } = require('../db/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const driveService = require('../googleDrive/driveService');

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

// Configure uploads. On Vercel, `dataDir` is /tmp because the deployment
// filesystem is read-only; locally it is the project root.
const { dataDir } = require('../utils/dataDir');
const uploadDir = path.join(dataDir, 'uploads');
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    // Accept any file type for configuration files
    cb(null, true);
  }
});

const uploadConfigFile = (req, res, next) => {
  upload.single('configFile')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Uploaded configuration file exceeds the 100MB size limit.' });
        }
        return res.status(400).json({ error: `File upload error: ${err.message}` });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
};

// Get next unattempted step for a user and test
router.get('/user/:userId/test/:testId/next', async (req, res) => {
  try {
    const { userId, testId } = req.params;
    
    // Get test name
    const test = await testsDb.prepare('SELECT name FROM tests WHERE id = ?').get(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    // Get all steps ordered by step_number
    const steps = await testsDb.prepare('SELECT * FROM test_steps WHERE test_id = ? ORDER BY step_number').all(testId);
    
    // Get attempted step IDs
    const attemptedRows = await testsDb.prepare(
      'SELECT step_id FROM test_results WHERE user_id = ? AND test_id = ?'
    ).all(userId, testId);
    const attemptedStepIds = attemptedRows.map(row => row.step_id);
    
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
    const userId = req.user.userId; // always from JWT — never trust client-supplied userId
    const { result, comment } = req.body;

    if (!result || !['pass', 'fail'].includes(result)) {
      return res.status(400).json({ error: 'Result must be pass or fail' });
    }

    const nowIso = new Date().toISOString();
    let configFilePath = null;
    if (req.file) {
      configFilePath = `/uploads/${req.file.filename}`;
      let dropboxFileId = null;
      try {
        const isDropboxActive = await require('../dropbox/dropboxService').isDropboxConfigured();
        if (isDropboxActive) {
          try {
            const fileBuffer = require('fs').readFileSync(req.file.path);
            dropboxFileId = await require('../dropbox/dropboxService').uploadFileToDropbox(
              fileBuffer,
              req.file.filename,
              req.file.mimetype || 'application/octet-stream'
            );
            console.log(`[Upload] Uploaded ${req.file.filename} to Dropbox (ID: ${dropboxFileId})`);
          } catch (dropboxErr) {
            console.error('[Upload] Dropbox upload failed, falling back to local/DB storage:', dropboxErr);
          }
        }

        const origName = req.file.originalname || req.file.filename;
        const mimeType = req.file.mimetype || 'application/octet-stream';
        let base64Data = null;
        if (!dropboxFileId) {
          const fileBuffer = require('fs').readFileSync(req.file.path);
          base64Data = fileBuffer.toString('base64');
        }

        await testsDb.prepare(`
          INSERT OR REPLACE INTO uploaded_files (filename, original_name, mime_type, file_size, dropbox_file_id, file_data, uploaded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(req.file.filename, origName, mimeType, req.file.size, dropboxFileId, base64Data, nowIso);
      } catch (uploadSaveErr) {
        console.error('Failed to save upload record:', uploadSaveErr);
      }
    }

    // The version the user is currently running. Every submission is tagged with
    // it so pass/fail, points, and "# tests done" can later be reported per version.
    const currentVersion = await testsDb.prepare('SELECT id FROM versions WHERE is_current = 1 LIMIT 1').get();
    const currentVersionId = currentVersion ? currentVersion.id : null;

    // The unique loop-round this submission belongs to (per user cycle).
    const roundNo = await getRound(userId);

    // Query preceding failed step submission before inserting the new submission
    const prevFailed = await testsDb.prepare(`
      SELECT ts.test_id, ts.step_id, ts.executed_at,
             t.name AS test_name,
             st.step_number, st.description AS step_description
      FROM test_submissions ts
      JOIN tests t ON ts.test_id = t.id
      JOIN test_steps st ON ts.step_id = st.id
      WHERE ts.user_id = ? AND ts.result = 'fail'
      ORDER BY ts.id DESC
      LIMIT 1
    `).get(userId);

    // Append-only audit ledger: every submission gets its own row with a unique
    // id, so a re-failure of the same step in a later round is a distinct,
    // traceable record (result + comment + uploaded file + round_id).
    const subId = await testsDb.prepare(`
      INSERT INTO test_submissions (round_id, user_id, test_id, step_id, result, comment, config_file_path, version_id, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(roundNo, userId, testId, stepId, result, comment || null, configFilePath, currentVersionId, nowIso);

    // Upsert: keep exactly ONE result row per (user, test, step) so the loop/next-step
    // logic and the per-step current view work. The full history lives in test_submissions.
    const prevResult = await testsDb.prepare(
      'SELECT config_file_path FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).get(userId, testId, stepId);

    await testsDb.prepare(
      'DELETE FROM test_results WHERE user_id = ? AND test_id = ? AND step_id = ?'
    ).run(userId, testId, stepId);

    const resultId = await testsDb.prepare(`
      INSERT INTO test_results (user_id, test_id, step_id, result, comment, config_file_path, version_id, round_id, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, testId, stepId, result, comment || null, configFilePath, currentVersionId, roundNo, nowIso);

    // Append to the points ledger on every submission so points accumulate
    // across loop iterations (and for both pass and fail results). The loop's
    // current progress is tracked separately via the upserted test_results row.
    const stepRow = await testsDb.prepare(
      'SELECT COALESCE(points, value, 0) AS pts, step_number, description, on_failure FROM test_steps WHERE id = ?'
    ).get(stepId);
    const stepPoints = stepRow ? (Number(stepRow.pts) || 0) : 0;

    let pointsAwarded = stepPoints;
    let warningCreated = null;

    // Cross-test consecutive failure rule check:
    // If the user fails a step and their preceding failed step was in another test
    // within the configured time threshold (default 3 minutes = 180 seconds),
    // 0 points are counted and a warning message is stored.
    let thresholdSec = 180;
    const cachedSettings = cache.get('settings');
    if (cachedSettings && cachedSettings.consecutive_failure_threshold_seconds) {
      thresholdSec = parseInt(cachedSettings.consecutive_failure_threshold_seconds.value, 10) || 180;
    } else {
      const settingRow = await testsDb.prepare("SELECT value FROM settings WHERE key = 'consecutive_failure_threshold_seconds'").get();
      thresholdSec = settingRow ? (parseInt(settingRow.value, 10) || 180) : 180;
    }

    if (result === 'fail' && prevFailed && prevFailed.test_id !== parseInt(testId, 10)) {
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
          INSERT INTO user_warnings (user_id, message, created_round, version_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, warningCreated, roundNo, currentVersionId, nowIso);
      }
    }

    await testsDb.prepare(
      'INSERT INTO points_log (user_id, test_id, step_id, points, version_id, round_id, earned_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, testId, stepId, pointsAwarded, currentVersionId, roundNo, nowIso);

    // Auto-end the test and advance the loop if:
    // 1. A hard-stop failure is submitted (on_failure === 'stop' or default 'stop')
    // 2. The current version differs from the version under which this test was started.
    let autoEnded = false;
    const stepOnFailure = stepRow ? (stepRow.on_failure || 'stop') : 'stop';
    const isHardStopFail = (result === 'fail' && stepOnFailure === 'stop');

    const loopState = await testsDb.prepare('SELECT version_id FROM user_loop_state WHERE user_id = ?').get(userId);
    const versionMismatch = loopState && loopState.version_id && currentVersionId && loopState.version_id !== currentVersionId;

    if (isHardStopFail || versionMismatch) {
      const assigned = await getAssignedTestsOrdered(userId);
      if (assigned.length > 0) {
        const idx = assigned.findIndex(t => t.id === parseInt(testId, 10));
        const nextTest = assigned[(idx + 1) % assigned.length];
        await testsDb.prepare('INSERT OR REPLACE INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)')
          .run(userId, nextTest.id, currentVersionId);
        if (nextTest.id === assigned[0].id) {
          await bumpRound(userId);
        }
        autoEnded = true;
      }
    }

    res.json({ id: resultId.lastInsertRowid, submissionId: subId.lastInsertRowid, roundId: roundNo, message: 'Result submitted successfully', autoEnded, warning: warningCreated });
  } catch (error) {
    console.error('Submit result error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get active rule warnings for the logged-in user (visible for 2 rounds)
router.get('/warnings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentRound = await getRound(userId);
    const warnings = await testsDb.prepare(`
      SELECT id, message, created_round, created_at
      FROM user_warnings
      WHERE user_id = ? AND (? - created_round) >= 0 AND (? - created_round) < 2
      ORDER BY id DESC
    `).all(userId, currentRound, currentRound);
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
    const userId = req.user.userId;
    const roundNo = await getRound(userId);

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

// Points summary for the logged-in user: total points earned this month
// (sum of the points ledger for every step submitted since the 1st of the
// current month). The ledger grows on every submission — including re-runs of
// the loop and failed steps — so points accumulate rather than freeze.
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const monthStartStr = `${monthStart.getFullYear()}-${pad(monthStart.getMonth() + 1)}-${pad(monthStart.getDate())} ${pad(monthStart.getHours())}:${pad(monthStart.getMinutes())}:${pad(monthStart.getSeconds())}`;

    const row = await testsDb.prepare(`
      SELECT COALESCE(SUM(points), 0) AS earned
      FROM points_log
      WHERE user_id = ? AND earned_at >= ?
    `).get(userId, monthStartStr);

    res.json({ monthEarned: row ? row.earned : 0, monthStart: monthStartStr });
  } catch (error) {
    console.error('Summary error:', error);
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