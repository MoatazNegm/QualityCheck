const express = require('express');
const router = express.Router();
const { testsDb, usersDb } = require('../db/db');
const { authenticateToken, requireAdmin, requireReportAccess } = require('../middleware/auth');

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
        AND strftime('%Y-%m', tr.executed_at) = strftime('%Y-%m', 'now')
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
  let start, end;

  switch (preset) {
    case 'current_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      break;
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'current_year':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
      break;
    case 'last_year':
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31);
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      break;
  }

  const formatLocalDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    start: formatLocalDate(start),
    end: formatLocalDate(end)
  };
}

// Get admin user report for a date range (admin, developer, or tester self-scoped)
router.get('/user-report', authenticateToken, requireReportAccess, async (req, res) => {
  try {
    const userIdsRaw = req.query.userId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionIdsRaw = req.query.versionIds;
    const versionIds = versionIdsRaw
      ? String(versionIdsRaw).split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id))
      : [];

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate, and endDate are required' });
    }
    if (req.reportScope !== 'self' && (!userIdsRaw || userIdsRaw === '')) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const userIds = String(userIdsRaw)
      .split(',')
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id));

    if (req.reportScope === 'self') {
      userIds.length = 0;
      userIds.push(req.selfUserId);
    }

    if (userIds.length === 0) {
      return res.status(400).json({ error: 'At least one valid userId is required' });
    }

    const placeholders = userIds.map(() => '?').join(',');
    const users = await usersDb.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`).all(...userIds);
    if (users.length === 0) {
      return res.status(404).json({ error: 'No valid users found' });
    }

    const start = startDate.length === 10 ? startDate : startDate.slice(0, 10);
    const end = (endDate.length === 10 ? endDate : endDate.slice(0, 10)) + 'T23:59:59.999Z';

    const versionFilter = versionIds.length > 0 ? ' AND pl.version_id IN (' + versionIds.map(() => '?').join(',') + ') ' : ' ';
    const versionFilterSub = versionIds.length > 0 ? ' AND s.version_id IN (' + versionIds.map(() => '?').join(',') + ') ' : ' ';

    const totalsRow = await testsDb.prepare(
      `SELECT COALESCE(SUM(points), 0) as totalPointsEarned, COUNT(*) as totalSteps
       FROM points_log pl
       WHERE pl.user_id IN (${placeholders}) AND pl.earned_at >= ? AND pl.earned_at <= ? ${versionFilter}`
    ).all(...userIds, start, end, ...versionIds);
    const totals = totalsRow[0];

    const rawAssignedTests = await testsDb.prepare(
      `SELECT DISTINCT t.id, t.name
       FROM tests t
       INNER JOIN test_assignments ta ON ta.test_id = t.id
       WHERE ta.user_id IN (${placeholders})
       ORDER BY t.name, t.id`
    ).all(...userIds);

    const nameToTestIdsMap = {};
    const uniqueTests = [];
    for (const t of rawAssignedTests) {
      if (!nameToTestIdsMap[t.name]) {
        nameToTestIdsMap[t.name] = [];
        uniqueTests.push(t);
      }
      nameToTestIdsMap[t.name].push(t.id);
    }

    const allUsersRows = await usersDb.prepare('SELECT id, username FROM users').all();
    const userNamesMap = Object.fromEntries(allUsersRows.map(u => [u.id, u.username]));

    const roundsMapRows = await testsDb.prepare(
      `SELECT s.test_id, COUNT(DISTINCT s.user_id || '-' || s.round_id) as rounds
       FROM test_submissions s
       WHERE s.user_id IN (${placeholders}) AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub}
       GROUP BY s.test_id`
    ).all(...userIds, start, end, ...versionIds);
    const roundsMap = Object.fromEntries(roundsMapRows.map(r => [r.test_id, r.rounds]));

    const failedSubmissions = await testsDb.prepare(
      `SELECT 
         s.test_id,
         s.user_id,
         u.username as user_name,
         s.step_id,
         ts.step_number,
         ts.description,
         ts.success_symptom,
         s.comment,
         s.config_file_path,
         s.round_id,
         s.executed_at
       FROM test_submissions s
       JOIN test_steps ts ON ts.id = s.step_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.user_id IN (${placeholders}) AND s.result = 'fail'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub}
       ORDER BY s.test_id, ts.step_number, s.executed_at DESC`
    ).all(...userIds, start, end, ...versionIds);

    const failedSubmissionsByTest = {};
    for (const row of failedSubmissions) {
      if (!failedSubmissionsByTest[row.test_id]) failedSubmissionsByTest[row.test_id] = [];
      const resolvedName = row.user_name || userNamesMap[row.user_id] || (row.user_id ? ('user ' + row.user_id) : '—');
      failedSubmissionsByTest[row.test_id].push({
        stepId: row.step_id,
        stepNumber: row.step_number,
        description: row.description,
        successSymptom: row.success_symptom || 'N/A',
        success_symptom: row.success_symptom || 'N/A',
        userId: row.user_id,
        userName: resolvedName,
        username: resolvedName,
        user_name: resolvedName,
        comment: row.comment,
        configFilePath: row.config_file_path,
        roundId: row.round_id,
        executed_at: row.executed_at
      });
    }

    const stepData = await testsDb.prepare(
      `SELECT 
         s.test_id,
         COUNT(s.id) as submissions,
         SUM(CASE WHEN s.result = 'pass' THEN 1 ELSE 0 END) as passes,
         SUM(CASE WHEN s.result = 'fail' THEN 1 ELSE 0 END) as fails
       FROM test_submissions s
       JOIN test_steps ts ON ts.id = s.step_id
       WHERE s.user_id IN (${placeholders}) AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub}
       GROUP BY s.test_id`
    ).all(...userIds, start, end, ...versionIds);
    const testLevelStats = {};
    for (const row of stepData) {
      testLevelStats[row.test_id] = { submissions: row.submissions, passes: row.passes || 0, fails: row.fails || 0 };
    }

    const stepCountsRows = await testsDb.prepare('SELECT test_id, COUNT(*) as c FROM test_steps GROUP BY test_id').all();
    const stepCountsMap = Object.fromEntries(stepCountsRows.map(r => [r.test_id, r.c]));

    // Determine fully passed tests in the selected version and date range from test_submissions
    const passedPerUserRounds = await testsDb.prepare(
      `SELECT s.user_id, s.test_id, s.round_id, COUNT(DISTINCT s.step_id) as passed_steps
       FROM test_submissions s
       WHERE s.user_id IN (${placeholders}) AND s.result = 'pass'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub}
       GROUP BY s.user_id, s.test_id, s.round_id`
    ).all(...userIds, start, end, ...versionIds);

    const usersFullyPassedByTest = {};
    for (const r of passedPerUserRounds) {
      const needed = stepCountsMap[r.test_id] || 0;
      if (needed > 0 && r.passed_steps >= needed) {
        if (!usersFullyPassedByTest[r.test_id]) usersFullyPassedByTest[r.test_id] = new Set();
        usersFullyPassedByTest[r.test_id].add(r.user_id);
      }
    }

    // Also check users who completed the last step of the test within the reporting period
    const allStepsRows = await testsDb.prepare('SELECT id, test_id, step_number FROM test_steps ORDER BY test_id, step_number').all();
    const lastStepByTest = {};
    for (const step of allStepsRows) {
      lastStepByTest[step.test_id] = step.id;
    }

    const lastStepSubmissions = await testsDb.prepare(
      `SELECT s.test_id, s.user_id, s.step_id, s.executed_at
       FROM test_submissions s
       WHERE s.user_id IN (${placeholders}) AND s.result = 'pass'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub}`
    ).all(...userIds, start, end, ...versionIds);

    for (const sub of lastStepSubmissions) {
      if (lastStepByTest[sub.test_id] && sub.step_id === lastStepByTest[sub.test_id]) {
        const needed = stepCountsMap[sub.test_id] || 0;
        const distinctPassed = await testsDb.prepare(
          `SELECT COUNT(DISTINCT step_id) as count
           FROM test_submissions
           WHERE test_id = ? AND user_id = ? AND result = 'pass' AND executed_at <= ?`
        ).get(sub.test_id, sub.user_id, sub.executed_at);

        if (needed > 0 && (distinctPassed?.count || 0) >= needed) {
          if (!usersFullyPassedByTest[sub.test_id]) usersFullyPassedByTest[sub.test_id] = new Set();
          usersFullyPassedByTest[sub.test_id].add(sub.user_id);
        }
      }
    }

    const tests = uniqueTests.map(uniqueTest => {
      const testIds = nameToTestIdsMap[uniqueTest.name] || [uniqueTest.id];
      
      let passes = 0;
      let fails = 0;
      let totalSubmissions = 0;
      let rounds = 0;
      let fullyPassed = false;
      const combinedFailedSubs = [];

      for (const tid of testIds) {
        const stats = testLevelStats[tid] || { submissions: 0, passes: 0, fails: 0 };
        passes += stats.passes;
        fails += stats.fails;
        totalSubmissions += stats.submissions;
        rounds += (roundsMap[tid] || 0);
        if (failedSubmissionsByTest[tid]) {
          combinedFailedSubs.push(...failedSubmissionsByTest[tid]);
        }

        const stepsCount = stepCountsMap[tid] || 0;
        if (stepsCount > 0) {
          const fullyPassedUsers = usersFullyPassedByTest[tid] || new Set();
          const hasActivity = stats.submissions > 0;
          const allPassed = hasActivity && userIds.every(uid => fullyPassedUsers.has(uid));
          if (allPassed) fullyPassed = true;
        }
      }

      const stepsMap = {};
      for (const sub of combinedFailedSubs) {
        if (!stepsMap[sub.stepId]) {
          stepsMap[sub.stepId] = {
            stepId: sub.stepId,
            stepNumber: sub.stepNumber,
            description: sub.description,
            successSymptom: sub.successSymptom || 'N/A',
            fails: 0,
            rounds: [],
            submissions: []
          };
        }
        stepsMap[sub.stepId].fails += 1;
        if (sub.roundId != null) {
          stepsMap[sub.stepId].rounds.push(sub.roundId);
        }
        stepsMap[sub.stepId].submissions.push({
          userId: sub.userId,
          userName: sub.userName,
          username: sub.username,
          user_name: sub.user_name,
          roundId: sub.roundId,
          comment: sub.comment,
          configFilePath: sub.configFilePath,
          executed_at: sub.executed_at
        });
      }
      const steps = Object.values(stepsMap);

      return {
        testId: uniqueTest.id,
        testName: uniqueTest.name,
        totalSubmissions,
        rounds,
        passes,
        fails,
        steps,
        fullyPassed
      };
    });

    const totalPassed = tests.reduce((sum, t) => sum + (t.passes || 0), 0);
    const totalFailed = tests.reduce((sum, t) => sum + (t.fails || 0), 0);

    res.json({
      startDate,
      endDate,
      versionIds: versionIds.length > 0 ? versionIds : null,
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

// Get total points earned per user over a date range (admin, developer, or tester self-scoped)
router.get('/points', authenticateToken, requireReportAccess, async (req, res) => {
  try {
    const userIdsRaw = req.query.userId;
    const testIdsRaw = req.query.testId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionIdsRaw = req.query.versionIds;
    const versionIds = versionIdsRaw
      ? String(versionIdsRaw).split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id))
      : [];

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = startDate.length === 10 ? startDate : startDate.slice(0, 10);
    const end = (endDate.length === 10 ? endDate : endDate.slice(0, 10)) + 'T23:59:59.999Z';

    let userIds = [];
    if (req.reportScope === 'self') {
      userIds = [req.selfUserId];
    } else if (userIdsRaw && userIdsRaw !== 'all') {
      userIds = String(userIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }

    let testIds = [];
    if (testIdsRaw && testIdsRaw !== 'all') {
      testIds = String(testIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }

    const hasUserFilter = userIds.length > 0;
    const userPlaceholders = hasUserFilter ? ` AND pl.user_id IN (${userIds.map(() => '?').join(',')}) ` : ' ';

    const hasTestFilter = testIds.length > 0;
    const testPlaceholders = hasTestFilter ? ` AND pl.test_id IN (${testIds.map(() => '?').join(',')}) ` : ' ';

    const hasVersionFilter = versionIds.length > 0;
    const versionPlaceholders = hasVersionFilter ? ` AND pl.version_id IN (${versionIds.map(() => '?').join(',')}) ` : ' ';

    const extraArgs = [
      ...(hasUserFilter ? userIds : []),
      ...(hasTestFilter ? testIds : []),
      ...(hasVersionFilter ? versionIds : [])
    ];

    const totalRow = await testsDb.prepare(
      `SELECT COALESCE(SUM(points), 0) as totalPointsEarned, COUNT(*) as totalSteps
       FROM points_log pl
       WHERE pl.earned_at >= ? AND pl.earned_at <= ? ${userPlaceholders} ${testPlaceholders} ${versionPlaceholders}`
    ).all(start, end, ...extraArgs);

    const perUserRows = await testsDb.prepare(
      `SELECT pl.user_id as userId, COALESCE(SUM(pl.points), 0) as pointsEarned, COUNT(*) as steps
       FROM points_log pl
       WHERE pl.earned_at >= ? AND pl.earned_at <= ? ${userPlaceholders} ${testPlaceholders} ${versionPlaceholders}
       GROUP BY pl.user_id
       ORDER BY pointsEarned DESC`
    ).all(start, end, ...extraArgs);

    const userNamesRows = await usersDb.prepare('SELECT id, username FROM users').all();
    const userNames = Object.fromEntries(userNamesRows.map(u => [u.id, u.username]));

    // Fetch cross-test consecutive failure warnings logged in the date range (filtered by version if specified)
    const userWarnFilter = hasUserFilter ? ` AND user_id IN (${userIds.map(() => '?').join(',')}) ` : ' ';
    const versionWarnFilter = hasVersionFilter ? ` AND (version_id IN (${versionIds.map(() => '?').join(',')}) OR version_id IS NULL) ` : ' ';
    const warnArgs = [start, end, ...(hasUserFilter ? userIds : []), ...(hasVersionFilter ? versionIds : [])];
    const warningsRows = await testsDb.prepare(
      `SELECT id, user_id, message, created_round, version_id, created_at
       FROM user_warnings
       WHERE created_at >= ? AND created_at <= ? ${userWarnFilter} ${versionWarnFilter}
       ORDER BY id DESC`
    ).all(...warnArgs);

    const warningsByUser = {};
    for (const w of warningsRows) {
      if (!warningsByUser[w.user_id]) warningsByUser[w.user_id] = [];
      warningsByUser[w.user_id].push({
        id: w.id,
        message: w.message,
        created_round: w.created_round,
        created_at: w.created_at
      });
    }

    const paymentsRows = await testsDb.prepare(
      `SELECT user_id, COALESCE(SUM(points_paid), 0) as pointsPaid
       FROM point_payments
       WHERE created_at >= ? AND created_at <= ? ${userWarnFilter}
       GROUP BY user_id`
    ).all(start, end, ...(hasUserFilter ? userIds : []));

    const paymentsByUser = {};
    for (const p of paymentsRows) {
      paymentsByUser[p.user_id] = p.pointsPaid;
    }

    const users = perUserRows.map(r => {
      const pointsEarned = r.pointsEarned;
      const pointsPaid = paymentsByUser[r.userId] || 0;
      const unpaidPoints = pointsEarned - pointsPaid;
      return {
        userId: r.userId,
        userName: userNames[r.userId] || ('user ' + r.userId),
        pointsEarned,
        pointsPaid,
        unpaidPoints,
        steps: r.steps,
        warningsCount: (warningsByUser[r.userId] || []).length,
        warnings: warningsByUser[r.userId] || []
      };
    });

    res.json({
      startDate,
      endDate,
      versionIds: versionIds.length > 0 ? versionIds : null,
      totalPointsEarned: totalRow[0] ? totalRow[0].totalPointsEarned : 0,
      totalSteps: totalRow[0] ? totalRow[0].totalSteps : 0,
      totalWarnings: warningsRows.length,
      warnings: warningsRows.map(w => ({
        ...w,
        userName: userNames[w.user_id] || ('user ' + w.user_id)
      })),
      users
    });
  } catch (error) {
    console.error('Points report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get admin test report for a date range (admin, developer, or tester self-scoped)
router.get('/test-report', authenticateToken, requireReportAccess, async (req, res) => {
  try {
    const testIdsRaw = req.query.testId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionIdsRaw = req.query.versionIds;
    const versionIds = versionIdsRaw
      ? String(versionIdsRaw).split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id))
      : [];
    const stepId = req.query.stepId ? parseInt(req.query.stepId, 10) : null;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = startDate.length === 10 ? startDate : startDate.slice(0, 10);
    const end = (endDate.length === 10 ? endDate : endDate.slice(0, 10)) + 'T23:59:59.999Z';

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
    const versionFilterSub = versionIds.length > 0 ? ' AND s.version_id IN (' + versionIds.map(() => '?').join(',') + ') ' : ' ';
    const stepFilterSub = stepId ? ' AND s.step_id = ? ' : ' ';
    const userScopeFilter = req.reportScope === 'self' ? ' AND s.user_id = ? ' : '';
    const userScopeArgs = req.reportScope === 'self' ? [req.selfUserId] : [];

    const testStatsRows = await testsDb.prepare(
      `SELECT s.test_id, COUNT(DISTINCT s.user_id || '-' || s.round_id) as rounds,
              SUM(CASE WHEN s.result = 'pass' THEN 1 ELSE 0 END) as passes,
              SUM(CASE WHEN s.result = 'fail' THEN 1 ELSE 0 END) as fails
       FROM test_submissions s
       WHERE s.test_id IN (${testPlaceholders}) AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${stepFilterSub} ${userScopeFilter}
       GROUP BY s.test_id`
    ).all(...testIds, start, end, ...versionIds, ...(stepId ? [stepId] : []), ...userScopeArgs);
    const testStats = Object.fromEntries(testStatsRows.map(r => [r.test_id, r]));

    const userNamesRows = await usersDb.prepare('SELECT id, username FROM users').all();
    const userNames = Object.fromEntries(userNamesRows.map(u => [u.id, u.username]));

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
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${stepFilterSub}
         ${req.reportScope === 'self' ? ' AND s.user_id = ? ' : ''}
       ORDER BY s.test_id, s.user_id, ts.step_number, s.executed_at DESC`
    ).all(...testIds, start, end, ...versionIds, ...(stepId ? [stepId] : []), ...userScopeArgs);

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
      const stats = testStats[test.id] || { passes: 0, fails: 0, rounds: 0 };
      const failedUsersMap = failedUsersByTest[test.id] || {};
      const failedUsers = Object.values(failedUsersMap);

      return {
        testId: test.id,
        testName: test.name,
        rounds: stats.rounds || 0,
        passes: stats.passes || 0,
        fails: stats.fails || 0,
        failedUsers
      };
    });

    res.json({
      startDate,
      endDate,
      versionIds: versionIds.length > 0 ? versionIds : null,
      stepId: stepId || null,
      tests: testsReport
    });
  } catch (error) {
    console.error('Test report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/passed-report', authenticateToken, requireReportAccess, async (req, res) => {
  try {
    const userIdsRaw = req.query.userId;
    const testIdsRaw = req.query.testId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionIdsRaw = req.query.versionIds;
    const versionIds = versionIdsRaw
      ? String(versionIdsRaw).split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id))
      : [];
    const stepId = req.query.stepId ? parseInt(req.query.stepId, 10) : null;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = startDate.length === 10 ? startDate : startDate.slice(0, 10);
    const end = (endDate.length === 10 ? endDate : endDate.slice(0, 10)) + 'T23:59:59.999Z';

    let userIds = [];
    if (req.reportScope === 'self') {
      userIds = [req.selfUserId];
    } else if (userIdsRaw && userIdsRaw !== 'all') {
      userIds = String(userIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }

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
    const versionFilterSub = versionIds.length > 0 
      ? ' AND (s.version_id IN (' + versionIds.map(() => '?').join(',') + ') OR s.version_id IS NULL) ' 
      : ' ';
    const stepFilterSub = stepId ? ' AND s.step_id = ? ' : ' ';
    const userFilterSub = userIds.length > 0 ? ' AND s.user_id IN (' + userIds.map(() => '?').join(',') + ') ' : ' ';

    // Step counts and last step ID per test to evaluate complete pass criteria
    const allStepsRows = await testsDb.prepare('SELECT id, test_id, step_number FROM test_steps ORDER BY test_id, step_number').all();
    const stepCountsMap = {};
    const lastStepByTest = {};
    for (const step of allStepsRows) {
      stepCountsMap[step.test_id] = (stepCountsMap[step.test_id] || 0) + 1;
      lastStepByTest[step.test_id] = step.id;
    }

    const testStatsRows = await testsDb.prepare(
      `SELECT s.test_id, COUNT(DISTINCT s.user_id || '-' || s.round_id) as rounds,
              SUM(CASE WHEN s.result = 'pass' THEN 1 ELSE 0 END) as passes,
              SUM(CASE WHEN s.result = 'fail' THEN 1 ELSE 0 END) as fails
       FROM test_submissions s
       WHERE s.test_id IN (${testPlaceholders}) AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${stepFilterSub} ${userFilterSub}
       GROUP BY s.test_id`
    ).all(...testIds, start, end, ...versionIds, ...(stepId ? [stepId] : []), ...(userIds.length > 0 ? userIds : []));
    const testStats = Object.fromEntries(testStatsRows.map(r => [r.test_id, r]));

    // 1. Count completions where the user finished (passed) the last step of the test within the reporting period
    const lastStepSubmissions = await testsDb.prepare(
      `SELECT s.test_id, s.user_id, s.step_id, s.round_id, s.executed_at
       FROM test_submissions s
       WHERE s.test_id IN (${testPlaceholders}) AND s.result = 'pass'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${userFilterSub}`
    ).all(...testIds, start, end, ...versionIds, ...(userIds.length > 0 ? userIds : []));

    const lastStepCompletionsByTest = {};
    for (const sub of lastStepSubmissions) {
      if (lastStepByTest[sub.test_id] && sub.step_id === lastStepByTest[sub.test_id]) {
        const needed = stepCountsMap[sub.test_id] || 0;
        const distinctPassed = await testsDb.prepare(
          `SELECT COUNT(DISTINCT step_id) as count
           FROM test_submissions
           WHERE test_id = ? AND user_id = ? AND result = 'pass' AND executed_at <= ?`
        ).get(sub.test_id, sub.user_id, sub.executed_at);

        if (needed > 0 && (distinctPassed?.count || 0) >= needed) {
          lastStepCompletionsByTest[sub.test_id] = (lastStepCompletionsByTest[sub.test_id] || 0) + 1;
        }
      }
    }

    // 2. Distinct passed steps per (user, round) for each test within reporting period
    const roundPassedRows = await testsDb.prepare(
      `SELECT s.test_id, s.user_id, s.round_id, COUNT(DISTINCT s.step_id) as passed_steps
       FROM test_submissions s
       WHERE s.test_id IN (${testPlaceholders}) AND s.result = 'pass'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${userFilterSub}
       GROUP BY s.test_id, s.user_id, s.round_id`
    ).all(...testIds, start, end, ...versionIds, ...(userIds.length > 0 ? userIds : []));

    const completelyPassedRoundsByTest = {};
    for (const r of roundPassedRows) {
      const needed = stepCountsMap[r.test_id] || r.passed_steps || 0;
      if (needed > 0 && r.passed_steps >= needed) {
        completelyPassedRoundsByTest[r.test_id] = (completelyPassedRoundsByTest[r.test_id] || 0) + 1;
      }
    }

    // 3. Distinct passed steps per user for each test within reporting period
    const userPassedRows = await testsDb.prepare(
      `SELECT s.test_id, s.user_id, COUNT(DISTINCT s.step_id) as passed_steps
       FROM test_submissions s
       WHERE s.test_id IN (${testPlaceholders}) AND s.result = 'pass'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${userFilterSub}
       GROUP BY s.test_id, s.user_id`
    ).all(...testIds, start, end, ...versionIds, ...(userIds.length > 0 ? userIds : []));

    const userPassedCountByTest = {};
    for (const u of userPassedRows) {
      const needed = stepCountsMap[u.test_id] || u.passed_steps || 0;
      if (needed > 0 && u.passed_steps >= needed) {
        userPassedCountByTest[u.test_id] = (userPassedCountByTest[u.test_id] || 0) + 1;
      }
    }

    const userNamesRows = await usersDb.prepare('SELECT id, username FROM users').all();
    const userNames = Object.fromEntries(userNamesRows.map(u => [u.id, u.username]));

    const passedSubmissions = await testsDb.prepare(
      `SELECT 
         s.test_id,
         s.user_id,
         u.username as user_name,
         s.step_id,
         ts.step_number,
         ts.description,
         ts.success_symptom,
         s.comment,
         s.config_file_path,
         s.round_id,
         s.executed_at
       FROM test_submissions s
       JOIN test_steps ts ON ts.id = s.step_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.test_id IN (${testPlaceholders}) AND s.result = 'pass'
         AND ((s.comment IS NOT NULL AND s.comment != '') OR (s.config_file_path IS NOT NULL AND s.config_file_path != ''))
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${stepFilterSub} ${userFilterSub}
       ORDER BY s.test_id, s.executed_at DESC, ts.step_number`
    ).all(...testIds, start, end, ...versionIds, ...(stepId ? [stepId] : []), ...(userIds.length > 0 ? userIds : []));

    const submissionsByTest = {};
    const passedUsersByTest = {};
    for (const row of passedSubmissions) {
      const resolvedName = row.user_name || userNames[row.user_id] || ('User ' + row.user_id);
      const subItem = {
        stepId: row.step_id,
        stepNumber: row.step_number,
        description: row.description,
        successSymptom: row.success_symptom || 'N/A',
        success_symptom: row.success_symptom || 'N/A',
        userId: row.user_id,
        userName: resolvedName,
        username: resolvedName,
        user_name: resolvedName,
        comment: row.comment,
        configFilePath: row.config_file_path,
        roundId: row.round_id,
        executed_at: row.executed_at
      };

      if (!submissionsByTest[row.test_id]) submissionsByTest[row.test_id] = [];
      submissionsByTest[row.test_id].push(subItem);

      if (!passedUsersByTest[row.test_id]) {
        passedUsersByTest[row.test_id] = {};
      }
      if (!passedUsersByTest[row.test_id][row.user_id]) {
        passedUsersByTest[row.test_id][row.user_id] = {
          userId: row.user_id,
          userName: resolvedName,
          submissions: []
        };
      }
      passedUsersByTest[row.test_id][row.user_id].submissions.push(subItem);
    }

    let totalCompletelyPassedRounds = 0;
    let totalRounds = 0;
    let totalPassedWithDetails = 0;

    const testsReport = tests.map(test => {
      const stats = testStats[test.id] || { passes: 0, fails: 0, rounds: 0 };
      const lastStepPasses = lastStepCompletionsByTest[test.id] || 0;
      const roundPasses = completelyPassedRoundsByTest[test.id] || 0;
      const userPasses = userPassedCountByTest[test.id] || 0;
      const completelyPassed = Math.max(lastStepPasses, roundPasses, userPasses);
      const testSubs = submissionsByTest[test.id] || [];
      const passedUsersMap = passedUsersByTest[test.id] || {};
      const passedUsers = Object.values(passedUsersMap);

      totalCompletelyPassedRounds += completelyPassed;
      totalRounds += (stats.rounds || 0);
      totalPassedWithDetails += testSubs.length;

      return {
        testId: test.id,
        testName: test.name,
        rounds: stats.rounds || 0,
        completelyPassedRounds: completelyPassed,
        fullyPassedRounds: completelyPassed,
        fullyPassed: completelyPassed > 0,
        passes: stats.passes || 0,
        fails: stats.fails || 0,
        submissions: testSubs,
        passedUsers
      };
    });

    const isSpecificTestFilter = testIdsRaw && testIdsRaw !== 'all';
    const filteredTestsReport = testsReport.filter(t => isSpecificTestFilter || t.rounds > 0 || t.submissions.length > 0);

    res.json({
      startDate,
      endDate,
      versionIds: versionIds.length > 0 ? versionIds : null,
      stepId: stepId || null,
      totalCompletelyPassedRounds,
      totalRounds,
      totalPassedWithDetails,
      tests: filteredTestsReport
    });
  } catch (error) {
    console.error('Passed report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get per-user test progress detail (admin/developer only)
// Returns: which tests the user fully passed, which had failures, which is active now, and current step
router.get('/user-progress/:userId', authenticateToken, requireReportAccess, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid userId' });

    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionIdsRaw = req.query.versionIds;
    const versionIds = versionIdsRaw
      ? String(versionIdsRaw).split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id))
      : [];

    const testIdsRaw = req.query.testId;
    let testIds = [];
    if (testIdsRaw && testIdsRaw !== 'all') {
      testIds = String(testIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = startDate.length === 10 ? startDate : startDate.slice(0, 10);
    const end = (endDate.length === 10 ? endDate : endDate.slice(0, 10)) + 'T23:59:59.999Z';

    // Fetch user info
    const userRow = await usersDb.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!userRow) return res.status(404).json({ error: 'User not found' });

    const hasTestFilter = testIds.length > 0;
    const testFilterAssigned = hasTestFilter ? ` AND t.id IN (${testIds.map(() => '?').join(',')}) ` : ' ';
    const testFilterPl = hasTestFilter ? ` AND pl.test_id IN (${testIds.map(() => '?').join(',')}) ` : ' ';
    const testFilterSub = hasTestFilter ? ` AND s.test_id IN (${testIds.map(() => '?').join(',')}) ` : ' ';

    // Fetch user's assigned tests ordered by test id (the loop order, optionally filtered by testIds)
    const assignedTests = await usersDb.prepare(
      `SELECT DISTINCT t.id, t.name FROM tests t
       INNER JOIN test_assignments ta ON ta.test_id = t.id
       WHERE ta.user_id = ? ${testFilterAssigned}
       ORDER BY t.id`
    ).all(userId, ...(hasTestFilter ? testIds : []));

    // Fetch user's active test from loop state
    const loopState = await usersDb.prepare(
      'SELECT active_test_id, version_id FROM user_loop_state WHERE user_id = ?'
    ).get(userId);
    const isVersionActive = !loopState || versionIds.length === 0 || (loopState.version_id && versionIds.includes(loopState.version_id));
    const activeTestId = (loopState && isVersionActive) ? loopState.active_test_id : null;

    // Fetch current round number for the user
    const roundRow = await usersDb.prepare(
      'SELECT round_no FROM user_rounds WHERE user_id = ?'
    ).get(userId);
    const currentRound = roundRow ? roundRow.round_no : 0;

    const versionFilterPl = versionIds.length > 0
      ? ' AND pl.version_id IN (' + versionIds.map(() => '?').join(',') + ') '
      : ' ';
    const versionFilterSub = versionIds.length > 0
      ? ' AND s.version_id IN (' + versionIds.map(() => '?').join(',') + ') '
      : ' ';

    // Batch: get points earned per test for this user in the date range
    const pointsRows = await usersDb.prepare(
      `SELECT pl.test_id, COALESCE(SUM(pl.points), 0) as pointsEarned
       FROM points_log pl
       WHERE pl.user_id = ? AND pl.earned_at >= ? AND pl.earned_at <= ? ${versionFilterPl} ${testFilterPl}
       GROUP BY pl.test_id`
    ).all(userId, start, end, ...versionIds, ...(hasTestFilter ? testIds : []));
    const pointsByTest = Object.fromEntries(pointsRows.map(r => [r.test_id, r.pointsEarned]));

    // Batch: get submission stats per test (rounds, pass count, fail count) in date range
    const subStatsRows = await usersDb.prepare(
      `SELECT s.test_id,
              COUNT(DISTINCT s.round_id) as rounds,
              SUM(CASE WHEN s.result = 'pass' THEN 1 ELSE 0 END) as passes,
              SUM(CASE WHEN s.result = 'fail' THEN 1 ELSE 0 END) as fails
       FROM test_submissions s
       WHERE s.user_id = ? AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${testFilterSub}
       GROUP BY s.test_id`
    ).all(userId, start, end, ...versionIds, ...(hasTestFilter ? testIds : []));
    const subStatsByTest = Object.fromEntries(subStatsRows.map(r => [r.test_id, r]));

    // Batch: get failed submissions per test (step number, round) for the user
    const failedSubRows = await usersDb.prepare(
      `SELECT s.test_id, ts.step_number, ts.description, s.round_id
       FROM test_submissions s
       JOIN test_steps ts ON ts.id = s.step_id
       WHERE s.user_id = ? AND s.result = 'fail'
         AND s.executed_at >= ? AND s.executed_at <= ? ${versionFilterSub} ${testFilterSub}
       ORDER BY s.test_id, ts.step_number, s.round_id`
    ).all(userId, start, end, ...versionIds, ...(hasTestFilter ? testIds : []));

    // Group failed steps by test, collapsing duplicate step+round pairs
    const failedByTest = {};
    for (const row of failedSubRows) {
      if (!failedByTest[row.test_id]) failedByTest[row.test_id] = {};
      const key = `${row.step_number}-${row.round_id}`;
      if (!failedByTest[row.test_id][key]) {
        failedByTest[row.test_id][key] = {
          stepNumber: row.step_number,
          description: row.description,
          roundId: row.round_id,
          fails: 0
        };
      }
      failedByTest[row.test_id][key].fails += 1;
    }

    // Determine active test step: first step not yet submitted in the current round
    let activeTestName = null;
    let currentStepNumber = null;
    let currentStepDescription = null;

    if (activeTestId) {
      const activeTest = assignedTests.find(t => t.id === activeTestId);
      if (activeTest) {
        activeTestName = activeTest.name;
        // Get all steps for the active test
        const allSteps = await usersDb.prepare(
          'SELECT id, step_number, description FROM test_steps WHERE test_id = ? ORDER BY step_number'
        ).all(activeTestId);
        // Get step IDs already submitted in the current round
        const doneRows = await usersDb.prepare(
          'SELECT DISTINCT step_id FROM test_results WHERE user_id = ? AND test_id = ? AND round_id = ?'
        ).all(userId, activeTestId, currentRound);
        const doneStepIds = new Set(doneRows.map(r => r.step_id));
        // First step not done
        const nextStep = allSteps.find(s => !doneStepIds.has(s.id));
        if (nextStep) {
          currentStepNumber = nextStep.step_number;
          currentStepDescription = nextStep.description;
        }
      }
    }

    const stepCountsRows = await testsDb.prepare('SELECT test_id, COUNT(*) as c FROM test_steps GROUP BY test_id').all();
    const stepCountsMap = Object.fromEntries(stepCountsRows.map(r => [r.test_id, r.c]));

    // Build per-test result array
    const tests = assignedTests.map(test => {
      const stats = subStatsByTest[test.id] || { rounds: 0, passes: 0, fails: 0 };
      const pointsEarned = pointsByTest[test.id] || 0;
      const failedSteps = Object.values(failedByTest[test.id] || {});
      const stepCount = stepCountsMap[test.id] || 0;

      let status;
      if (test.id === activeTestId && isVersionActive) {
        status = 'in_progress';
      } else if (stats.rounds === 0) {
        status = 'not_started';
      } else if (stats.fails === 0 && stats.passes >= stepCount && stepCount > 0) {
        status = 'fully_passed';
      } else if (stats.fails > 0) {
        status = 'failed';
      } else {
        status = 'in_progress';
      }

      return {
        testId: test.id,
        testName: test.name,
        rounds: stats.rounds,
        pointsEarned,
        status,
        failedSteps
      };
    });

    // Fetch cross-test consecutive failure warnings logged for this user in date range
    const versionWarnFilter = versionIds.length > 0 ? ' AND (version_id IN (' + versionIds.map(() => '?').join(',') + ') OR version_id IS NULL) ' : ' ';
    const userWarnings = await usersDb.prepare(
      `SELECT id, message, created_round, version_id, created_at
       FROM user_warnings
       WHERE user_id = ? AND created_at >= ? AND created_at <= ? ${versionWarnFilter}
       ORDER BY id DESC`
    ).all(userId, start, end, ...versionIds);

    res.json({
      userId,
      userName: userRow.username,
      versionIds: versionIds.length > 0 ? versionIds : null,
      activeTestId,
      activeTestName,
      currentStepNumber,
      currentStepDescription,
      warnings: userWarnings,
      tests
    });
  } catch (error) {
    console.error('User progress report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get points payments history
router.get('/points-payments', authenticateToken, requireReportAccess, async (req, res) => {
  try {
    const userIdsRaw = req.query.userId;
    let userIds = [];
    if (req.reportScope === 'self') {
      userIds = [req.selfUserId];
    } else if (userIdsRaw && userIdsRaw !== 'all') {
      userIds = String(userIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }

    const hasUserFilter = userIds.length > 0;
    const userFilterSql = hasUserFilter ? ` WHERE p.user_id IN (${userIds.map(() => '?').join(',')}) ` : '';

    const payments = await testsDb.prepare(
      `SELECT p.id, p.user_id as userId, p.points_paid as pointsPaid, p.admin_id as adminId, p.created_at as createdAt, u.username as userName, a.username as adminName
       FROM point_payments p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN users a ON p.admin_id = a.id
       ${userFilterSql}
       ORDER BY p.created_at DESC`
    ).all(...(hasUserFilter ? userIds : []));

    res.json({ payments });
  } catch (error) {
    console.error('Points payments report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get failed steps report
router.get('/failed-report', authenticateToken, requireReportAccess, async (req, res) => {
  try {
    const userIdsRaw = req.query.userId;
    const testIdsRaw = req.query.testId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const versionIdsRaw = req.query.versionIds;
    const versionIds = versionIdsRaw
      ? String(versionIdsRaw).split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id))
      : [];

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = startDate.length === 10 ? startDate : startDate.slice(0, 10);
    const end = (endDate.length === 10 ? endDate : endDate.slice(0, 10)) + 'T23:59:59.999Z';

    let userIds = [];
    if (req.reportScope === 'self') {
      userIds = [req.selfUserId];
    } else if (userIdsRaw && userIdsRaw !== 'all') {
      userIds = String(userIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }

    let testIds = [];
    if (testIdsRaw && testIdsRaw !== 'all') {
      testIds = String(testIdsRaw)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }

    const userFilter = userIds.length > 0 ? ' AND s.user_id IN (' + userIds.map(() => '?').join(',') + ') ' : ' ';
    const testFilter = testIds.length > 0 ? ' AND s.test_id IN (' + testIds.map(() => '?').join(',') + ') ' : ' ';
    const versionFilter = versionIds.length > 0 ? ' AND s.version_id IN (' + versionIds.map(() => '?').join(',') + ') ' : ' ';

    const userNamesRows = await usersDb.prepare('SELECT id, username FROM users').all();
    const userNames = Object.fromEntries(userNamesRows.map(u => [u.id, u.username]));

    const testsRows = await testsDb.prepare('SELECT id, name FROM tests').all();
    const testNames = Object.fromEntries(testsRows.map(t => [t.id, t.name]));

    const failedSubmissions = await testsDb.prepare(
      `SELECT 
         s.test_id,
         s.user_id,
         s.step_id,
         ts.step_number,
         ts.description,
         ts.success_symptom,
         s.comment,
         s.config_file_path,
         s.round_id,
         s.executed_at
       FROM test_submissions s
       JOIN test_steps ts ON ts.id = s.step_id
       WHERE s.result = 'fail'
         AND s.executed_at >= ? AND s.executed_at <= ? 
         ${versionFilter} ${testFilter} ${userFilter}
       ORDER BY s.executed_at DESC`
    ).all(
      start, 
      end, 
      ...versionIds, 
      ...testIds, 
      ...userIds
    );

    const stepsMap = {};
    for (const row of failedSubmissions) {
      if (!stepsMap[row.step_id]) {
        stepsMap[row.step_id] = {
          stepId: row.step_id,
          testId: row.test_id,
          testName: testNames[row.test_id] || ('Test ' + row.test_id),
          stepNumber: row.step_number,
          description: row.description,
          successSymptom: row.success_symptom || 'N/A',
          success_symptom: row.success_symptom || 'N/A',
          failCount: 0,
          failures: []
        };
      }
      stepsMap[row.step_id].failCount++;
      stepsMap[row.step_id].failures.push({
        userId: row.user_id,
        userName: userNames[row.user_id] || ('User ' + row.user_id),
        comment: row.comment,
        configFilePath: row.config_file_path,
        roundId: row.round_id,
        executedAt: row.executed_at
      });
    }

    const steps = Object.values(stepsMap).sort((a, b) => b.failCount - a.failCount);

    res.json({
      startDate,
      endDate,
      versionIds: versionIds.length > 0 ? versionIds : null,
      steps
    });
  } catch (error) {
    console.error('Failed report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;