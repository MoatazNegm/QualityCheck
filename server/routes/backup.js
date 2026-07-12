const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { usersDb, testsDb } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { dataDir } = require('../utils/dataDir');

const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Magic bytes for a gzipped stream (RFC 1952): 0x1f 0x8b.
function isGzipped(buf) {
  return buf && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// Read every uploaded config file that is still referenced by a test result (or a
// submission in the audit ledger) and embed it (base64) into the backup so a restore
// reproduces the system exactly, including the files users uploaded on failed steps.
function collectReferencedFiles() {
  const rows = testsDb.prepare(
    `SELECT DISTINCT config_file_path FROM test_results WHERE config_file_path IS NOT NULL
     UNION
     SELECT DISTINCT config_file_path FROM test_submissions WHERE config_file_path IS NOT NULL`
  ).all();
  const files = [];
  for (const { config_file_path } of rows) {
    if (!config_file_path) continue;
    const fileName = path.basename(config_file_path);
    const absPath = path.join(uploadDir, fileName);
    if (fs.existsSync(absPath)) {
      const data = fs.readFileSync(absPath);
      files.push({ path: config_file_path, data: data.toString('base64') });
    }
  }
  return files;
}

const upload = multer({ storage: multer.memoryStorage() });
const jsonParser = express.json({ limit: '1mb' });

router.get('/export', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = usersDb.prepare('SELECT id, username, is_admin FROM users').all();
    const tests = testsDb.prepare('SELECT * FROM tests').all();
    const testSteps = testsDb.prepare('SELECT * FROM test_steps').all();
    const testResults = testsDb.prepare('SELECT * FROM test_results').all();
    const testSubmissions = testsDb.prepare('SELECT * FROM test_submissions').all();
    const testAssignments = testsDb.prepare('SELECT * FROM test_assignments').all();
    const userLoopState = testsDb.prepare('SELECT * FROM user_loop_state').all();
    const userTestRounds = testsDb.prepare('SELECT * FROM user_test_rounds').all();
    const pointsLog = testsDb.prepare('SELECT * FROM points_log').all();
    const versions = testsDb.prepare('SELECT * FROM versions').all();

    const files = collectReferencedFiles();

    const backup = {
      metadata: {
        exportedAt: new Date().toISOString(),
        app: 'QualityCheck',
        includesFiles: true,
      },
      users,
      tests,
      test_steps: testSteps,
      test_results: testResults,
      test_submissions: testSubmissions,
      test_assignments: testAssignments,
      user_loop_state: userLoopState,
      user_test_rounds: userTestRounds,
      points_log: pointsLog,
      versions,
      files,
    };

    const filename = `qualitycheck-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    console.error('Backup export error:', error);
    res.status(500).json({ error: 'Failed to export backup' });
  }
});

// Apply a parsed backup object to the live databases. Used by both the small
// single-request /import and the chunked /import-finalize flows. Sends the
// final JSON response on `res`.
function applyBackup(backup, res) {
  if (!backup || !Array.isArray(backup.users) || !Array.isArray(backup.tests)) {
    return res.status(400).json({ error: 'Invalid backup file format' });
  }

  usersDb.prepare('DELETE FROM user_sessions').run();
  usersDb.prepare('DELETE FROM users').run();

  testsDb.prepare('DELETE FROM test_results').run();
  testsDb.prepare('DELETE FROM test_submissions').run();
  testsDb.prepare('DELETE FROM test_assignments').run();
  testsDb.prepare('DELETE FROM user_loop_state').run();
  testsDb.prepare('DELETE FROM user_test_rounds').run();
  testsDb.prepare('DELETE FROM points_log').run();
  testsDb.prepare('DELETE FROM test_steps').run();
  testsDb.prepare('DELETE FROM tests').run();
  testsDb.prepare('DELETE FROM versions').run();

  const insertUser = usersDb.prepare(`
    INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)
  `);

  for (const user of backup.users) {
    const passwordHash = user.password_hash || bcrypt.hashSync('changeme', 10);
    insertUser.run(user.id, user.username, passwordHash, user.is_admin ? 1 : 0);
  }

  const insertTest = testsDb.prepare('INSERT INTO tests (id, name, description) VALUES (?, ?, ?)');
  const insertStep = testsDb.prepare(`
    INSERT INTO test_steps (id, test_id, step_number, description, success_symptom, value, on_failure)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertResult = testsDb.prepare(`
    INSERT INTO test_results (id, user_id, test_id, step_id, result, comment, config_file_path, version_id, round_id, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSubmission = testsDb.prepare(`
    INSERT INTO test_submissions (id, round_id, user_id, test_id, step_id, result, comment, config_file_path, version_id, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAssignment = testsDb.prepare(`
    INSERT INTO test_assignments (id, test_id, user_id, assigned_at) VALUES (?, ?, ?, ?)
  `);
  const insertLoopState = testsDb.prepare(`
    INSERT INTO user_loop_state (user_id, active_test_id, version_id) VALUES (?, ?, ?)
  `);
  const insertUserTestRound = testsDb.prepare(`
    INSERT OR REPLACE INTO user_test_rounds (user_id, test_id, round_no) VALUES (?, ?, ?)
  `);
  const insertPointsLog = testsDb.prepare(`
    INSERT INTO points_log (id, user_id, test_id, step_id, points, version_id, earned_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVersion = testsDb.prepare(`
    INSERT INTO versions (id, name, note, is_current, created_at) VALUES (?, ?, ?, ?, ?)
  `);

  for (const test of backup.tests) {
    insertTest.run(test.id, test.name, test.description);
  }

  for (const v of backup.versions || []) {
    insertVersion.run(v.id, v.name, v.note, v.is_current ? 1 : 0, v.created_at);
  }

  for (const step of backup.test_steps || []) {
    insertStep.run(step.id, step.test_id, step.step_number, step.description, step.success_symptom, step.value, step.on_failure);
  }

  for (const result of backup.test_results || []) {
    insertResult.run(
      result.id,
      result.user_id,
      result.test_id,
      result.step_id,
      result.result,
      result.comment,
      result.config_file_path,
      result.version_id ?? null,
      result.round_id ?? null,
      result.executed_at
    );
  }

  for (const sub of backup.test_submissions || []) {
    insertSubmission.run(
      sub.id,
      sub.round_id ?? null,
      sub.user_id,
      sub.test_id,
      sub.step_id,
      sub.result,
      sub.comment,
      sub.config_file_path,
      sub.version_id ?? null,
      sub.executed_at
    );
  }

  for (const assignment of backup.test_assignments || []) {
    insertAssignment.run(assignment.id, assignment.test_id, assignment.user_id, assignment.assigned_at);
  }

  for (const loop of backup.user_loop_state || []) {
    insertLoopState.run(loop.user_id, loop.active_test_id, loop.version_id ?? null);
  }

  for (const r of backup.user_test_rounds || []) {
    insertUserTestRound.run(r.user_id, r.test_id, r.round_no ?? 1);
  }

  for (const pl of backup.points_log || []) {
    insertPointsLog.run(pl.id, pl.user_id, pl.test_id, pl.step_id, pl.points, pl.version_id ?? null, pl.earned_at);
  }

  // Restore the uploaded config files that were embedded in the backup so the
  // restored system is byte-for-byte complete (comments + their attachments).
  const restoredFiles = [];
  for (const f of backup.files || []) {
    if (!f || !f.path || !f.data) continue;
    const fileName = path.basename(f.path);
    const absPath = path.join(uploadDir, fileName);
    try {
      fs.writeFileSync(absPath, Buffer.from(f.data, 'base64'));
      restoredFiles.push(fileName);
    } catch (e) {
      console.error('Failed to restore upload file', fileName, e);
    }
  }

  res.json({ message: 'Restore completed successfully', restoredFiles: restoredFiles.length });
}

// Single-request import. Kept for small backups and backwards compatibility.
// Accepts gzipped JSON (detected via magic bytes) or plain JSON.
router.post('/import', authenticateToken, requireAdmin, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const buf = req.file.buffer;
    let json;
    if (isGzipped(buf)) {
      try {
        json = zlib.gunzipSync(buf).toString('utf-8');
      } catch (e) {
        return res.status(400).json({ error: 'Failed to decompress backup (corrupt gzip)' });
      }
    } else {
      json = buf.toString('utf-8');
    }

    let backup;
    try {
      backup = JSON.parse(json);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON in backup file' });
    }

    applyBackup(backup, res);
  } catch (error) {
    console.error('Backup import error:', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

// Chunked upload for backups too large for a single Vercel function request
// (Vercel hard-caps serverless function bodies at 4.5 MB). The client gzips
// the backup JSON, splits it into 3 MB chunks, and posts each chunk here in
// order. When all chunks for an `uploadId` are present, the client posts
// /import-finalize and the server reassembles, decompresses, and applies.
//
// Chunks are stored under dataDir/import-chunks/<uploadId>/<chunkIndex> so they
// survive across the multiple function invocations on Vercel (/tmp persists
// for the lifetime of a serverless function instance and is shared across
// invocations to the same instance).

router.post('/import-chunk', authenticateToken, requireAdmin, upload.single('chunk'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No chunk uploaded' });
    }
    const { uploadId, chunkIndex, totalChunks } = req.body || {};
    if (!uploadId || chunkIndex === undefined || !totalChunks) {
      return res.status(400).json({ error: 'Missing uploadId, chunkIndex, or totalChunks' });
    }
    const idx = parseInt(chunkIndex, 10);
    const total = parseInt(totalChunks, 10);
    if (!Number.isInteger(idx) || !Number.isInteger(total) || idx < 0 || idx >= total) {
      return res.status(400).json({ error: 'Invalid chunkIndex or totalChunks' });
    }

    // Defence in depth: prevent path traversal via crafted uploadId.
    if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) {
      return res.status(400).json({ error: 'Invalid uploadId' });
    }

    const chunkDir = path.join(dataDir, 'import-chunks', uploadId);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }
    fs.writeFileSync(path.join(chunkDir, String(idx)), req.file.buffer);

    res.json({ message: 'Chunk received', chunkIndex: idx, totalChunks: total });
  } catch (error) {
    console.error('Import chunk error:', error);
    res.status(500).json({ error: 'Failed to receive chunk' });
  }
});

router.post('/import-finalize', authenticateToken, requireAdmin, jsonParser, (req, res) => {
  const cleanup = (dir) => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  };

  try {
    const { uploadId, totalChunks } = req.body || {};
    if (!uploadId || !totalChunks) {
      return res.status(400).json({ error: 'Missing uploadId or totalChunks' });
    }
    if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) {
      return res.status(400).json({ error: 'Invalid uploadId' });
    }
    const total = parseInt(totalChunks, 10);
    if (!Number.isInteger(total) || total <= 0) {
      return res.status(400).json({ error: 'Invalid totalChunks' });
    }

    const chunkDir = path.join(dataDir, 'import-chunks', uploadId);
    if (!fs.existsSync(chunkDir)) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    // Reassemble in order. If any chunk is missing we abort and clean up.
    const chunks = [];
    for (let i = 0; i < total; i++) {
      const chunkPath = path.join(chunkDir, String(i));
      if (!fs.existsSync(chunkPath)) {
        cleanup(chunkDir);
        return res.status(400).json({ error: `Chunk ${i} of ${total} is missing` });
      }
      chunks.push(fs.readFileSync(chunkPath));
    }

    const assembled = Buffer.concat(chunks);

    // Try gzip first; fall back to raw JSON. The client always gzips, but
    // accepting plain JSON keeps this endpoint usable from curl/scripts.
    let backup;
    if (isGzipped(assembled)) {
      try {
        const json = zlib.gunzipSync(assembled).toString('utf-8');
        backup = JSON.parse(json);
      } catch (e) {
        cleanup(chunkDir);
        return res.status(400).json({ error: 'Failed to decompress or parse gzipped backup' });
      }
    } else {
      try {
        backup = JSON.parse(assembled.toString('utf-8'));
      } catch (e) {
        cleanup(chunkDir);
        return res.status(400).json({ error: 'Invalid JSON in backup data' });
      }
    }

    applyBackup(backup, res);
    // Clean up the chunk directory only on success. On error, applyBackup
    // has already sent the response and the catch in /import-finalize will
    // also clean up via its own try/finally.
    cleanup(chunkDir);
  } catch (error) {
    console.error('Import finalize error:', error);
    try {
      const { uploadId } = req.body || {};
      if (uploadId && /^[A-Za-z0-9_-]+$/.test(uploadId)) {
        cleanup(path.join(dataDir, 'import-chunks', uploadId));
      }
    } catch (_) { /* ignore */ }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to finalize import' });
    }
  }
});

module.exports = router;
