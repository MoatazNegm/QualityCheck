const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { usersDb, testsDb, getRound } = require('../db/db');
const { authenticateToken, requireAdmin, requireDeveloper } = require('../middleware/auth');
const { dataDir } = require('../utils/dataDir');
const { isGlobalAdminUser, getUserAssignedApps, getAppId } = require('../utils/appContext');
const fs = require('fs');
const path = require('path');

// Get all users (admin or developer only)
router.get('/', authenticateToken, requireDeveloper, async (req, res) => {
  try {
    const isGlobal = isGlobalAdminUser(req.user);
    const callerApps = getUserAssignedApps(req.user);

    const users = await usersDb.prepare(
      'SELECT id, username, is_admin, is_suspended, user_groups FROM users'
    ).all();
    
    // Batch query active keys for all users
    let keysByUser = {};
    try {
      const allKeys = await testsDb.prepare(
        'SELECT id, name, key_prefix, role, is_active, user_id, COALESCE(app_id, 1) as app_id, created_at, last_used_at FROM api_keys ORDER BY created_at DESC'
      ).all();
      for (const k of allKeys) {
        if (!keysByUser[k.user_id]) keysByUser[k.user_id] = [];
        keysByUser[k.user_id].push(k);
      }
    } catch (kErr) {
      console.warn('Non-fatal: could not query api_keys for users list:', kErr.message);
    }

    // Batch query assigned apps for all users
    let appsByUser = {};
    try {
      const allUserApps = await testsDb.prepare(`
        SELECT ua.user_id, a.id, a.name, a.description
        FROM user_apps ua
        JOIN apps a ON ua.app_id = a.id
        ORDER BY a.id
      `).all();
      for (const ua of allUserApps) {
        if (!appsByUser[ua.user_id]) appsByUser[ua.user_id] = [];
        appsByUser[ua.user_id].push({ id: ua.id, name: ua.name, description: ua.description });
      }
    } catch (appErr) {
      console.warn('Non-fatal: could not query user_apps:', appErr.message);
    }

    // Batch query test assignments by app for all users
    let testsByUserAndApp = {};
    try {
      const allAssignments = await testsDb.prepare(`
        SELECT ta.user_id, ta.test_id, COALESCE(t.app_id, 1) as app_id
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE COALESCE(t.is_deleted, 0) = 0
      `).all();
      for (const ta of allAssignments) {
        if (!testsByUserAndApp[ta.user_id]) testsByUserAndApp[ta.user_id] = {};
        if (!testsByUserAndApp[ta.user_id][ta.app_id]) testsByUserAndApp[ta.user_id][ta.app_id] = [];
        testsByUserAndApp[ta.user_id][ta.app_id].push(ta.test_id);
      }
    } catch (testErr) {
      console.warn('Non-fatal: could not query assignments by app:', testErr.message);
    }

    let filteredUsers = users;
    if (!isGlobal) {
      filteredUsers = users.filter(u => {
        // Root admin is not shown to app-scoped admins unless assigned to that app
        const uApps = (appsByUser[u.id] || []).map(a => a.id);
        return uApps.some(aid => callerApps.includes(aid));
      });
    }

    const formatted = filteredUsers.map(u => {
      const allowedAppObjs = (appsByUser[u.id] || []).filter(a => isGlobal || callerApps.includes(a.id));
      const allowedAppIds = allowedAppObjs.map(a => a.id);
      const allowedTestsByApp = {};
      for (const aid of allowedAppIds) {
        if (testsByUserAndApp[u.id]?.[aid]) {
          allowedTestsByApp[aid] = testsByUserAndApp[u.id][aid];
        }
      }
      return {
        ...u,
        user_groups: typeof u.user_groups === 'string' ? JSON.parse(u.user_groups) : (u.user_groups || (u.is_admin ? ['admins'] : ['testers'])),
        api_keys: (keysByUser[u.id] || []).filter(k => isGlobal || callerApps.includes(k.app_id || 1)),
        assigned_apps: allowedAppIds,
        assigned_app_objects: allowedAppObjs,
        assigned_tests_by_app: allowedTestsByApp
      };
    });
    
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk user summaries (admin/developer only) — replaces N+1 frontend loops
router.get('/summaries', authenticateToken, requireDeveloper, async (req, res) => {
  try {
    const allUsers = await usersDb.prepare(
      'SELECT id, username, is_admin, is_suspended, user_groups FROM users'
    ).all();
    const nonAdminUsers = allUsers.filter(u => !u.is_admin);
    const userIds = nonAdminUsers.map(u => u.id);
    if (userIds.length === 0) return res.json({});

    const appId = getAppId(req);
    const isAll = appId === 'all';
    const cleanAppId = isAll ? null : (parseInt(appId, 10) || 1);

    // Batch: assigned test counts per user (non-deleted tests, scoped by app)
    let assignedRows;
    if (isAll) {
      assignedRows = await testsDb.prepare(`
        SELECT ta.user_id, COUNT(*) AS c
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE COALESCE(t.is_deleted, 0) = 0
        GROUP BY ta.user_id
      `).all();
    } else {
      assignedRows = await testsDb.prepare(`
        SELECT ta.user_id, COUNT(*) AS c
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE COALESCE(t.is_deleted, 0) = 0 AND t.app_id = ?
        GROUP BY ta.user_id
      `).all(cleanAppId);
    }
    const assignedMap = Object.fromEntries(assignedRows.map(r => [r.user_id, r.c]));

    // Batch: completed rounds per user for current app scope
    let roundRows;
    if (isAll) {
      roundRows = await testsDb.prepare(`
        SELECT user_id, MAX(round_no) as round_no
        FROM user_rounds
        GROUP BY user_id
      `).all();
    } else {
      roundRows = await testsDb.prepare(`
        SELECT user_id, round_no
        FROM user_rounds
        WHERE app_id = ?
      `).all(cleanAppId);
    }
    const roundsMap = Object.fromEntries(roundRows.map(r => [r.user_id, r.round_no]));

    // Batch: done step counts per user+test for each user's current round in current app
    let doneRows;
    if (isAll) {
      doneRows = await testsDb.prepare(`
        SELECT tr.user_id, tr.test_id, COUNT(*) AS c
        FROM test_results tr
        JOIN tests t ON tr.test_id = t.id
        LEFT JOIN user_rounds ur ON ur.user_id = tr.user_id AND ur.app_id = tr.app_id
        WHERE COALESCE(t.is_deleted, 0) = 0
          AND COALESCE(tr.round_id, 0) = COALESCE(ur.round_no, 0)
        GROUP BY tr.user_id, tr.test_id
      `).all();
    } else {
      doneRows = await testsDb.prepare(`
        SELECT tr.user_id, tr.test_id, COUNT(*) AS c
        FROM test_results tr
        JOIN tests t ON tr.test_id = t.id
        LEFT JOIN user_rounds ur ON ur.user_id = tr.user_id AND ur.app_id = ?
        WHERE COALESCE(t.is_deleted, 0) = 0
          AND tr.app_id = ?
          AND COALESCE(tr.round_id, 0) = COALESCE(ur.round_no, 0)
        GROUP BY tr.user_id, tr.test_id
      `).all(cleanAppId, cleanAppId);
    }
    const doneMap = {};
    for (const r of doneRows) {
      if (!doneMap[r.user_id]) doneMap[r.user_id] = {};
      doneMap[r.user_id][r.test_id] = r.c;
    }

    // Batch: total step counts per test (excluding section headers)
    const stepRows = await testsDb.prepare(
      'SELECT test_id, COUNT(*) AS c FROM test_steps WHERE COALESCE(points, value, 0) != -1 GROUP BY test_id'
    ).all();
    const stepMap = Object.fromEntries(stepRows.map(r => [r.test_id, r.c]));

    // Batch: hard-stop failure counts per user+test in the current round
    let failRows;
    if (isAll) {
      failRows = await testsDb.prepare(`
        SELECT ts.user_id, ts.test_id, COUNT(*) AS c
        FROM test_submissions ts
        JOIN tests t ON ts.test_id = t.id
        JOIN test_steps tstep ON ts.step_id = tstep.id
        LEFT JOIN user_rounds ur ON ur.user_id = ts.user_id AND ur.app_id = ts.app_id
        WHERE COALESCE(t.is_deleted, 0) = 0
          AND ts.result = 'fail' AND tstep.on_failure = 'stop'
          AND COALESCE(ts.round_id, 0) = COALESCE(ur.round_no, 0)
        GROUP BY ts.user_id, ts.test_id
      `).all();
    } else {
      failRows = await testsDb.prepare(`
        SELECT ts.user_id, ts.test_id, COUNT(*) AS c
        FROM test_submissions ts
        JOIN tests t ON ts.test_id = t.id
        JOIN test_steps tstep ON ts.step_id = tstep.id
        LEFT JOIN user_rounds ur ON ur.user_id = ts.user_id AND ur.app_id = ?
        WHERE COALESCE(t.is_deleted, 0) = 0
          AND ts.app_id = ?
          AND ts.result = 'fail' AND tstep.on_failure = 'stop'
          AND COALESCE(ts.round_id, 0) = COALESCE(ur.round_no, 0)
        GROUP BY ts.user_id, ts.test_id
      `).all(cleanAppId, cleanAppId);
    }
    const failMap = {};
    for (const r of failRows) {
      if (!failMap[r.user_id]) failMap[r.user_id] = {};
      failMap[r.user_id][r.test_id] = r.c;
    }

    // Batch: assignments per user (non-deleted tests, scoped by app)
    let assignmentRows;
    if (isAll) {
      assignmentRows = await testsDb.prepare(`
        SELECT ta.user_id, ta.test_id
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE COALESCE(t.is_deleted, 0) = 0
      `).all();
    } else {
      assignmentRows = await testsDb.prepare(`
        SELECT ta.user_id, ta.test_id
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE COALESCE(t.is_deleted, 0) = 0 AND t.app_id = ?
      `).all(cleanAppId);
    }
    const userAssignments = {};
    for (const r of assignmentRows) {
      if (!userAssignments[r.user_id]) userAssignments[r.user_id] = [];
      userAssignments[r.user_id].push(r.test_id);
    }

    const summaries = {};
    for (const u of nonAdminUsers) {
      const assignments = userAssignments[u.id] || [];
      let completedCount = 0;
      let failedHardStopCount = 0;
      const userDone = doneMap[u.id] || {};
      const userFails = failMap[u.id] || {};

      for (const testId of assignments) {
        const totalSteps = stepMap[testId] || 0;
        const doneSteps = userDone[testId] || 0;
        if (totalSteps > 0 && doneSteps >= totalSteps) {
          completedCount++;
        } else if ((userFails[testId] || 0) > 0) {
          failedHardStopCount++;
        }
      }

      summaries[u.id] = {
        assignedCount: assignments.length,
        completedCount,
        failedHardStopCount,
        completedRounds: roundsMap[u.id] || 0
      };
    }

    res.json(summaries);
  } catch (error) {
    console.error('Bulk summaries error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get test summary for a user (admin only)
router.get('/:id/test-summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const appId = getAppId(req);
    const isAll = appId === 'all';
    const cleanAppId = isAll ? 1 : (parseInt(appId, 10) || 1);

    let assigned;
    if (isAll) {
      assigned = await testsDb.prepare(`
        SELECT ta.test_id
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE ta.user_id = ? AND COALESCE(t.is_deleted, 0) = 0
      `).all(userId);
    } else {
      assigned = await testsDb.prepare(`
        SELECT ta.test_id
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE ta.user_id = ? AND t.app_id = ? AND COALESCE(t.is_deleted, 0) = 0
      `).all(userId, cleanAppId);
    }

    const assignedCount = assigned.length;
    let completedCount = 0;
    let failedHardStopCount = 0;
    const currentRound = await getRound(userId, cleanAppId);

    for (const row of assigned) {
      const testId = row.test_id;
      const stepCountRow = await testsDb.prepare(
        'SELECT COUNT(*) as c FROM test_steps WHERE test_id = ? AND COALESCE(points, value, 0) != -1'
      ).get(testId);
      const doneCountRow = await testsDb.prepare(
        'SELECT COUNT(*) as c FROM test_results WHERE user_id = ? AND test_id = ? AND COALESCE(round_id, 0) = ?'
      ).get(userId, testId, currentRound);

      const stepCount = stepCountRow ? (stepCountRow.c || 0) : 0;
      const doneCount = doneCountRow ? (doneCountRow.c || 0) : 0;

      if (stepCount > 0 && doneCount >= stepCount) {
        completedCount++;
      } else {
        const failRow = await testsDb.prepare(`
          SELECT COUNT(*) as c FROM test_submissions ts
          JOIN test_steps tstep ON ts.step_id = tstep.id
          WHERE ts.user_id = ? AND ts.test_id = ? AND ts.result = 'fail' AND tstep.on_failure = 'stop' AND COALESCE(ts.round_id, 0) = ?
        `).get(userId, testId, currentRound);

        if (failRow && failRow.c > 0) {
          failedHardStopCount++;
        }
      }
    }

    res.json({ assignedCount, completedCount, failedHardStopCount });
  } catch (error) {
    console.error('Get user test summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get completed rounds count for a user (admin only)
router.get('/:id/completed-rounds', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const filterAppId = getAppId(req);
    let row;
    if (filterAppId === 'all') {
      row = await testsDb.prepare(
        'SELECT MAX(round_no) as completedRounds FROM user_rounds WHERE user_id = ?'
      ).get(userId);
    } else {
      row = await testsDb.prepare(
        'SELECT round_no as completedRounds FROM user_rounds WHERE user_id = ? AND app_id = ?'
      ).get(userId, filterAppId);
    }

    res.json({ completedRounds: row ? row.completedRounds : 0 });
  } catch (error) {
    console.error('Get completed rounds error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single user details and statistics (admin, developer, or self)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const groups = req.user.userGroups || [];
    const isPrivileged = !!req.user.isAdmin || req.user.role === 'admin' || groups.includes('admins') || groups.includes('developers');
    if (!isPrivileged && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const user = await usersDb.prepare('SELECT id, username, is_admin, is_suspended, user_groups, created_at FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let parsedGroups = [];
    try {
      parsedGroups = typeof user.user_groups === 'string' ? JSON.parse(user.user_groups) : (user.user_groups || []);
    } catch {
      parsedGroups = user.is_admin ? ['admins'] : ['testers'];
    }

    const filterAppId = getAppId(req);
    let roundRow;
    if (filterAppId === 'all') {
      roundRow = await testsDb.prepare('SELECT MAX(round_no) as round_no FROM user_rounds WHERE user_id = ?').get(userId);
    } else {
      roundRow = await testsDb.prepare('SELECT round_no FROM user_rounds WHERE user_id = ? AND app_id = ?').get(userId, filterAppId);
    }
    let assignedRow;
    if (filterAppId === 'all') {
      assignedRow = await testsDb.prepare(`
        SELECT COUNT(*) as c
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE ta.user_id = ? AND COALESCE(t.is_deleted, 0) = 0
      `).get(userId);
    } else {
      assignedRow = await testsDb.prepare(`
        SELECT COUNT(*) as c
        FROM test_assignments ta
        JOIN tests t ON ta.test_id = t.id
        WHERE ta.user_id = ? AND t.app_id = ? AND COALESCE(t.is_deleted, 0) = 0
      `).get(userId, filterAppId);
    }
    const pointsRow = await testsDb.prepare('SELECT COALESCE(SUM(points), 0) as totalPoints FROM points_log WHERE user_id = ?').get(userId);

    res.json({
      id: user.id,
      username: user.username,
      is_admin: !!user.is_admin,
      is_suspended: !!user.is_suspended,
      user_groups: parsedGroups,
      created_at: user.created_at || null,
      stats: {
        completedRounds: roundRow ? roundRow.round_no : 0,
        assignedTestsCount: assignedRow ? assignedRow.c : 0,
        totalPointsEarned: pointsRow ? pointsRow.totalPoints : 0
      }
    });
  } catch (error) {
    console.error('Get user by id error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, user_groups, appIds, testAssignmentsByApp } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    let groups = user_groups;
    if (!groups || !Array.isArray(groups) || groups.length === 0) {
      groups = isAdmin ? ['admins'] : ['testers'];
    }
    const groupsJson = JSON.stringify(groups);

    const result = await usersDb.prepare(`
      INSERT INTO users (username, password_hash, is_admin, user_groups)
      VALUES (?, ?, ?, ?)
    `).run(username, hashedPassword, isAdmin ? 1 : 0, groupsJson);

    const newUserId = result.lastInsertRowid;

    // Assign apps (default to App 1 if none specified)
    let selectedAppIds = Array.isArray(appIds) && appIds.length > 0 ? appIds.map(id => parseInt(id, 10)) : [1];

    for (const appId of selectedAppIds) {
      await testsDb.prepare('INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)').run(newUserId, appId);

      // Determine tests to assign for this app
      let testsToAssign = [];
      if (testAssignmentsByApp && Array.isArray(testAssignmentsByApp[appId])) {
        testsToAssign = testAssignmentsByApp[appId];
      } else {
        // By default, assign all non-deleted tests of this app
        const appTests = await testsDb.prepare('SELECT id FROM tests WHERE (app_id = ? OR app_id IS NULL) AND COALESCE(is_deleted, 0) = 0').all(appId);
        testsToAssign = appTests.map(t => t.id);
      }

      for (const tId of testsToAssign) {
        await testsDb.prepare('INSERT OR IGNORE INTO test_assignments (test_id, user_id) VALUES (?, ?)').run(tId, newUserId);
      }
    }

    res.json({ id: newUserId, username, is_admin: isAdmin ? 1 : 0, user_groups: groups, appIds: selectedAppIds });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

const uploadDir = path.join(dataDir, 'uploads');

// Delete user (admin only) — cascades every piece of data tied to the user
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await usersDb.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Capture the uploaded files this user submitted before deleting the rows.
    const fileRows = await testsDb.prepare(
      'SELECT DISTINCT config_file_path FROM test_results WHERE user_id = ? AND config_file_path IS NOT NULL'
    ).all(userId);
    const filesToDelete = fileRows
      .map(r => r.config_file_path)
      .filter(Boolean)
      .map(p => path.basename(p));

    // Cascade delete in a transaction batch.
    await testsDb.client.batch([
      { sql: 'DELETE FROM user_sessions WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM api_keys WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM user_apps WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM test_results WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM test_submissions WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM points_log WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM test_assignments WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM user_loop_state WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM user_rounds WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM user_warnings WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM users WHERE id = ?', args: [userId] }
    ], 'write');

    // Remove the user's uploaded files from disk and database.
    let deletedFiles = 0;
    for (const fileName of filesToDelete) {
      const absPath = path.join(uploadDir, fileName);
      if (fs.existsSync(absPath)) {
        try {
          fs.unlinkSync(absPath);
          deletedFiles++;
        } catch (e) {
          console.error('Failed to delete upload file from disk', fileName, e);
        }
      }
      try {
        await testsDb.prepare('DELETE FROM uploaded_files WHERE filename = ?').run(fileName);
      } catch (e) {
        console.error('Failed to delete upload file from DB', fileName, e);
      }
    }

    res.json({ message: 'User and all associated data deleted successfully', deletedFiles });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user role, groups, assigned apps and tests (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const isGlobal = isGlobalAdminUser(req.user);
    const callerApps = getUserAssignedApps(req.user);

    if (!isGlobal) {
      const targetUserApps = (await testsDb.prepare('SELECT app_id FROM user_apps WHERE user_id = ?').all(id)).map(r => r.app_id);
      if (targetUserApps.length > 0 && !targetUserApps.some(aid => callerApps.includes(aid))) {
        return res.status(403).json({ error: 'You do not have permission to manage this user' });
      }
    }

    const { is_admin, user_groups, appIds, testAssignmentsByApp } = req.body;
    
    let groups = user_groups;
    if (!groups || !Array.isArray(groups)) {
      groups = is_admin ? ['admins'] : ['testers'];
    }
    // Only global system admin can grant is_admin = 1. App-scoped users are never global admins.
    const isAdminCalc = isGlobal && (groups.includes('admins') || (is_admin ? 1 : 0));
    const groupsJson = JSON.stringify(groups);
    
    await usersDb.prepare(
      'UPDATE users SET is_admin = ?, user_groups = ? WHERE id = ?'
    ).run(isAdminCalc ? 1 : 0, groupsJson, id);

    // If appIds provided, update user_apps and test assignments
    if (Array.isArray(appIds)) {
      let targetAppIds = appIds.map(a => typeof a === 'object' && a !== null ? parseInt(a.id, 10) : parseInt(a, 10)).filter(n => !isNaN(n));
      if (!isGlobal) {
        targetAppIds = targetAppIds.filter(aid => callerApps.includes(aid));
      }
      if (targetAppIds.length > 0) {
        const placeholders = targetAppIds.map(() => '?').join(',');
        await testsDb.prepare(`DELETE FROM user_apps WHERE user_id = ? AND app_id NOT IN (${placeholders})`).run(id, ...targetAppIds);
        await testsDb.prepare(`
          DELETE FROM test_assignments WHERE user_id = ? AND test_id IN (
            SELECT id FROM tests WHERE app_id NOT IN (${placeholders})
          )
        `).run(id, ...targetAppIds);
      } else {
        await testsDb.prepare('DELETE FROM user_apps WHERE user_id = ?').run(id);
        await testsDb.prepare('DELETE FROM test_assignments WHERE user_id = ?').run(id);
      }

      for (const appId of targetAppIds) {
        await testsDb.prepare('INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)').run(id, appId);

        if (testAssignmentsByApp && Array.isArray(testAssignmentsByApp[appId])) {
          await testsDb.prepare(`
            DELETE FROM test_assignments WHERE user_id = ? AND test_id IN (
              SELECT id FROM tests WHERE (app_id = ? OR app_id IS NULL)
            )
          `).run(id, appId);

          for (const tId of testAssignmentsByApp[appId]) {
            await testsDb.prepare('INSERT OR IGNORE INTO test_assignments (test_id, user_id) VALUES (?, ?)').run(tId, id);
          }
        }
      }
    }
    
    res.json({ message: 'User updated successfully', user_groups: groups, is_admin: isAdminCalc ? 1 : 0 });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle user suspension (admin only)
router.put('/:id/suspend', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_suspended } = req.body;
    
    await usersDb.prepare(
      'UPDATE users SET is_suspended = ? WHERE id = ?'
    ).run(is_suspended ? 1 : 0, id);
    
    res.json({ message: 'User suspension updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change user password (admin only)
router.put('/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    
    if (!password || password.trim().length === 0) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    const hashedPassword = await bcrypt.hash(password.trim(), 10);
    
    await usersDb.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).run(hashedPassword, id);
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Pay points for user (admin only)
router.post('/:id/pay-points', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { points } = req.body;
    
    if (typeof points !== 'number' || points <= 0) {
      return res.status(400).json({ error: 'Valid positive points amount is required' });
    }
    
    const userId = parseInt(id, 10);
    const adminId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : null;
    
    await usersDb.prepare(
      'INSERT INTO point_payments (user_id, points_paid, admin_id) VALUES (?, ?, ?)'
    ).run(userId, points, adminId);
    
    res.json({ message: 'Points paid successfully' });
  } catch (error) {
    console.error('Pay points error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// List keys for a user (admin or developer only)
router.get('/:id/keys', authenticateToken, requireDeveloper, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const keys = await testsDb.prepare(`
      SELECT id, name, key_prefix, role, is_active, created_at, last_used_at, user_id
      FROM api_keys
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);
    res.json(keys);
  } catch (error) {
    console.error('List user keys error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate a new key for this user (admin only)
router.post('/:id/generate-key', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const crypto = require('crypto');
    const userId = parseInt(req.params.id, 10);
    const user = await usersDb.prepare('SELECT id, username, is_admin, user_groups FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { name, role, appId } = req.body || {};
    const targetAppId = parseInt(appId || req.headers['x-app-id'], 10) || 1;

    // Ensure user has access to target application
    await testsDb.prepare('INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)').run(user.id, targetAppId);

    const validRoles = ['tester', 'developer', 'admin'];
    let defaultRole = user.is_admin ? 'admin' : 'tester';
    try {
      const groups = typeof user.user_groups === 'string' ? JSON.parse(user.user_groups) : (user.user_groups || []);
      if (groups.includes('admins')) defaultRole = 'admin';
      else if (groups.includes('developers')) defaultRole = 'developer';
    } catch {}
    const chosenRole = validRoles.includes(role) ? role : defaultRole;
    const keyName = (name && String(name).trim()) || `${user.username}-key`;

    const randomHex = crypto.randomBytes(24).toString('hex');
    const rawApiKey = `qc_${randomHex}`;
    const keyPrefix = `qc_${randomHex.substring(0, 8)}...`;
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    const result = await testsDb.prepare(`
      INSERT INTO api_keys (name, key_hash, key_prefix, user_id, role, is_active, app_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(keyName, keyHash, keyPrefix, user.id, chosenRole, targetAppId);

    res.status(201).json({
      message: `API key generated successfully for user "${user.username}".`,
      key: rawApiKey,
      apiKey: {
        id: result.lastInsertRowid,
        name: keyName,
        key_prefix: keyPrefix,
        role: chosenRole,
        user_id: user.id,
        username: user.username,
        app_id: targetAppId,
        is_active: 1,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Generate user key error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Revoke all generated keys for this user without deleting the user (admin only)
router.delete('/:id/revoke-key', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await usersDb.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete keys for this user from api_keys - preserving the user in users table
    await testsDb.prepare('DELETE FROM api_keys WHERE user_id = ?').run(userId);

    // Invalidate sessions so user cannot remain logged in via the revoked key
    try {
      await usersDb.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
    } catch (sessErr) {
      console.warn('Non-fatal: session cleanup failed:', sessErr.message);
    }

    res.json({
      message: `Generated key(s) revoked successfully for user "${user.username}". The user account has been preserved and can be issued a new key later.`,
      userId: user.id
    });
  } catch (error) {
    console.error('Revoke user key error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;