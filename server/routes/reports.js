const express = require('express');
const router = express.Router();
const { testsDb, usersDb } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Get detailed test results for a user
router.get('/test/:testId/user/:userId', async (req, res) => {
  try {
    const { testId, userId } = req.params;
    
    const test = await testsDb.prepare(
      'SELECT * FROM tests WHERE id = ?'
    ).get(testId);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    const steps = await testsDb.prepare(`
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
    console.error('Get test user report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get monthly financial summary for a user
router.get('/monthly/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const results = await testsDb.prepare(`
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
    console.error('Get monthly report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

function getDateRange(preset) {
  const now = new Date();
  const start = new Date();
  const end = new Date();

  switch (preset) {
    case 'current_month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'last_month': {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      start.setMonth(start.getMonth() - 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'current_year':
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'last_year':
      start.setFullYear(now.getFullYear() - 1, 0, 1);
      start.setHours(0, 0, 0, 0);
      end.setFullYear(now.getFullYear() - 1, 11, 31);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      break;
  }

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

// Get admin user report for a date range (admin only)
router.get('/user-report', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userIdsRaw = req.query.userId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionId = req.query.versionId ? parseInt(req.query.versionId, 10) : null;

    if (!userIdsRaw || !startDate || !endDate) {
      return res.status(400).json({ error: 'userId, startDate, and endDate are required' });
    }

    const userIds = String(userIdsRaw)
      .split(',')
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id));

    if (userIds.length === 0) {
      return res.status(400).json({ error: 'At least one valid userId is required' });
    }

    const placeholders = userIds.map(() => '?').join(',');
    const users = await usersDb.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`).all(...userIds);
    if (users.length === 0) {
      return res.status(404).json({ error: 'No valid users found' });
    }

    const start = startDate + ' 00:00:00';
    const end = endDate + ' 23:59:59';

    const versionFilter = versionId ? ' AND pl.version_id = ? ' : ' ';
    const versionFilterSub = versionId ? ' AND s.version_id = ? ' : ' ';

    const totalsRow = await testsDb.prepare(
      `SELECT COALESCE(SUM(points), 0) as totalPointsEarned, COUNT(*) as totalSteps
       FROM points_log pl
       WHERE pl.user_id IN (${placeholders}) AND pl.earned_at >= ? AND pl.earned_at <= ? ${versionFilter}`
    ).all(...userIds, start, end, ...(versionId ? [versionId] : []));
    const totals = totalsRow[0];

    const assignedTests = await testsDb.prepare(
      `SELECT t.id, t.name
       FROM tests t
       INNER JOIN test_assignments ta ON ta.test_id = t.id
       WHERE ta.user_id IN (${placeholders})
       ORDER BY t.id`
    ).all(...userIds);

    const testSubMapRows = await testsDb.prepare(
      `SELECT test_id, COUNT(*) as submissions
       FROM points_log pl
       WHERE pl.user_id IN (${placeholders}) AND pl.earned_at >= ? AND pl.earned_at <= ? ${versionFilter}
       GROUP BY test_id`
    ).all(...userIds, start, end, ...(versionId ? [versionId] : []));
    const testSubMap = Object.fromEntries(testSubMapRows.map(r => [r.test_id, r.submissions]));

    // Full failure history from the append-only audit ledger. We return every
    // failed submission as its own record so the report can show one line per
    // failure, each with its own comment, uploaded file, and round.
    const failedSubmissions = await testsDb.prepare(
      `SELECT 
         s.test_id,
         s.step_id,
         ts.step_number,
         ts.description,
         s.comment,
         s.config_file_path,
         s.round_id,
         s.executed_at
       FROM test_submissions s
       JOIN test_steps ts ON ts.id = s.step_id
       WHERE s.user_id IN (${placeholders}) AND s.result = 'fail'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub}
       ORDER BY s.test_id, ts.step_number, s.executed_at DESC`
    ).all(...userIds, start, end, ...(versionId ? [versionId] : []));

    const failedSubmissionsByTest = {};
    for (const row of failedSubmissions) {
      if (!failedSubmissionsByTest[row.test_id]) failedSubmissionsByTest[row.test_id] = [];
      failedSubmissionsByTest[row.test_id].push({
        stepId: row.step_id,
        stepNumber: row.step_number,
        description: row.description,
        comment: row.comment,
        configFilePath: row.config_file_path,
        roundId: row.round_id,
        executed_at: row.executed_at
      });
    }

    // Keep per-test stats from the aggregated step data.
    const testLevelStats = {};
    const stepData = await testsDb.prepare(
      `SELECT 
         s.test_id,
         COUNT(s.id) as submissions,
         SUM(CASE WHEN s.result = 'pass' THEN 1 ELSE 0 END) as passes,
         SUM(CASE WHEN s.result = 'fail' THEN 1 ELSE 0 END) as fails
       FROM test_submissions s
       WHERE s.user_id IN (${placeholders}) AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub}
       GROUP BY s.test_id`
    ).all(...userIds, start, end, ...(versionId ? [versionId] : []));
    for (const row of stepData) {
      testLevelStats[row.test_id] = { submissions: row.submissions, passes: row.passes || 0, fails: row.fails || 0 };
    }

    const fullyPassedTests = new Set();
    for (const test of assignedTests) {
      const stepsCountRow = await testsDb.prepare('SELECT COUNT(*) as c FROM test_steps WHERE test_id = ?').get(test.id);
      const stepsCount = stepsCountRow ? stepsCountRow.c : 0;
      if (stepsCount === 0) continue;
      
      const passedStepsRow = await testsDb.prepare(
        `SELECT COUNT(*) as c FROM test_results tr WHERE tr.user_id IN (${placeholders}) AND tr.test_id = ? AND tr.result = ? ${versionId ? ' AND tr.version_id = ? ' : ' '}`
      ).all(...userIds, test.id, 'pass', ...(versionId ? [versionId] : []));
      const passedSteps = passedStepsRow[0] ? passedStepsRow[0].c : 0;
      
      const hasActivity = (testSubMap[test.id] || 0) > 0;
      if (passedSteps >= stepsCount && hasActivity) {
        fullyPassedTests.add(test.id);
      }
    }

    const tests = assignedTests.map(test => {
      const stats = testLevelStats[test.id] || { submissions: 0, passes: 0, fails: 0 };
      const totalSubmissions = testSubMap[test.id] || 0;

      return {
        testId: test.id,
        testName: test.name,
        totalSubmissions,
        rounds: stats.submissions,
        passes: stats.passes,
        fails: stats.fails,
        failedSubmissions: failedSubmissionsByTest[test.id] || [],
        fullyPassed: fullyPassedTests.has(test.id)
      };
    });

    const totalPassed = tests.reduce((sum, t) => sum + (t.passes || 0), 0);
    const totalFailed = tests.reduce((sum, t) => sum + (t.fails || 0), 0);

    res.json({
      startDate,
      endDate,
      versionId: versionId || null,
      totalPointsEarned: totals ? totals.totalPointsEarned : 0,
      totalSteps: totals ? totals.totalSteps : 0,
      summary: {
        totalPoints: totals ? totals.totalPointsEarned : 0,
        totalPassed,
        totalFailed
      },
      users: users.map(u => ({ userId: u.id, userName: u.username })),
      tests
    });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get admin test report for a date range (admin only)
router.get('/test-report', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const testIdsRaw = req.query.testId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionId = req.query.versionId ? parseInt(req.query.versionId, 10) : null;
    const stepId = req.query.stepId ? parseInt(req.query.stepId, 10) : null;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = startDate + ' 00:00:00';
    const end = endDate + ' 23:59:59';

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
    const versionFilter = versionId ? ' AND version_id = ? ' : ' ';
    const stepFilter = stepId ? ' AND step_id = ? ' : ' ';

    const testStatsRows = await testsDb.prepare(
      `SELECT test_id, COUNT(*) as rounds,
              SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) as passes,
              SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) as fails
       FROM test_submissions
       WHERE test_id IN (${testPlaceholders}) AND executed_at >= ? AND executed_at <= ? ${versionFilter} ${stepFilter}
       GROUP BY test_id`
    ).all(...testIds, start, end, ...(versionId ? [versionId] : []), ...(stepId ? [stepId] : []));
    const testStats = Object.fromEntries(testStatsRows.map(r => [r.test_id, r]));

    const roundsMapRows = await testsDb.prepare(
      `SELECT test_id, COUNT(*) as rounds
       FROM points_log
       WHERE test_id IN (${testPlaceholders}) AND earned_at >= ? AND earned_at <= ? ${versionFilter} ${stepFilter}
       GROUP BY test_id`
    ).all(...testIds, start, end, ...(versionId ? [versionId] : []), ...(stepId ? [stepId] : []));
    const roundsMap = Object.fromEntries(roundsMapRows.map(r => [r.test_id, r.rounds]));

    // Usernames live in users.db, which is a separate database from tests.db, so
    // we look them up by id rather than JOINing across databases.
    const userNamesRows = await usersDb.prepare('SELECT id, username FROM users').all();
    const userNames = Object.fromEntries(userNamesRows.map(u => [u.id, u.username]));

    // Full failure history from the append-only audit ledger. We return every
    // failed submission as its own record so the report can show one line per
    // failure, each with its own comment, uploaded file, and round.
    const failedSubmissions = await testsDb.prepare(
      `SELECT 
         s.test_id,
         s.user_id,
         s.step_id,
         ts.step_number,
         ts.description,
         s.comment,
         s.config_file_path,
         s.round_id,
         s.executed_at
       FROM test_submissions s
       JOIN test_steps ts ON ts.id = s.step_id
       WHERE s.test_id IN (${testPlaceholders}) AND s.result = 'fail'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilter} ${stepFilter}
       ORDER BY s.test_id, s.user_id, ts.step_number, s.executed_at DESC`
    ).all(...testIds, start, end, ...(versionId ? [versionId] : []), ...(stepId ? [stepId] : []));

    const failedUsersByTest = {};
    for (const row of failedSubmissions) {
      if (!failedUsersByTest[row.test_id]) {
        failedUsersByTest[row.test_id] = {};
      }
      if (!failedUsersByTest[row.test_id][row.user_id]) {
        failedUsersByTest[row.test_id][row.user_id] = {
          userId: row.user_id,
          userName: userNames[row.user_id] || ('user ' + row.user_id),
          submissions: []
        };
      }
      failedUsersByTest[row.test_id][row.user_id].submissions.push({
        stepId: row.step_id,
        stepNumber: row.step_number,
        description: row.description,
        comment: row.comment,
        configFilePath: row.config_file_path,
        roundId: row.round_id,
        executed_at: row.executed_at
      });
    }

    const testsReport = tests.map(test => {
      const stats = testStats[test.id] || { passes: 0, fails: 0 };
      const rounds = roundsMap[test.id] || 0;
      const failedUsersMap = failedUsersByTest[test.id] || {};
      const failedUsers = Object.values(failedUsersMap);

      return {
        testId: test.id,
        testName: test.name,
        rounds,
        passes: stats.passes,
        fails: stats.fails,
        failedUsers
      };
    });

    res.json({
      startDate,
      endDate,
      versionId: versionId || null,
      stepId: stepId || null,
      tests: testsReport
    });
  } catch (error) {
    console.error('Test report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;