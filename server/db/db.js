const Database = require('better-sqlite3');
const path = require('path');
const { dataDir } = require('../utils/dataDir');

// Users database — local SQLite file on disk (dataDir = project root locally,
// /tmp on Vercel). On Vercel, /tmp is ephemeral (wiped on cold start/deploy).
// For persistent Turso storage, set TURSO_DATABASE_URL env var (see README).
const usersDb = new Database(path.join(dataDir, 'users.db'), { filename: true });
const testsDb = new Database(path.join(dataDir, 'tests.db'), { filename: true });

// Disable WAL mode on both databases. WAL creates separate .db-wal and .db-shm
// files that are tied to the specific /tmp inode. On Vercel, multiple serverless
// instances each have their own /tmp, so each creates its own WAL files. A read
// can then hit an instance whose WAL hasn't been flushed, seeing stale or empty data.
// DELETE journal mode keeps a single .db-journal file and is more resilient to
// multi-instance /tmp isolation. Note: this doesn't fully solve Vercel ephemerality
// (data is still wiped on cold start) but it prevents cross-instance corruption.
usersDb.pragma('journal_mode = DELETE');
testsDb.pragma('journal_mode = DELETE');

// Initialize tables
function initDB() {
  usersDb.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT 0
  )`);

  usersDb.exec(`CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    token TEXT UNIQUE,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  testsDb.exec(`CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT
  )`);

  testsDb.exec(`CREATE TABLE IF NOT EXISTS test_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER,
    step_number INTEGER NOT NULL,
    description TEXT NOT NULL,
    success_symptom TEXT,
    value REAL DEFAULT 0,
    on_failure TEXT CHECK (on_failure IN ('continue', 'stop')) DEFAULT 'stop',
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
  )`);

  testsDb.exec(`CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    test_id INTEGER,
    step_id INTEGER,
    result TEXT CHECK (result IN ('pass', 'fail')) NOT NULL,
    comment TEXT,
    config_file_path TEXT,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
    FOREIGN KEY (step_id) REFERENCES test_steps(id) ON DELETE CASCADE
  )`);

  testsDb.exec(`CREATE TABLE IF NOT EXISTS test_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
    UNIQUE(test_id, user_id)
  )`);

  // Per-user sequential loop state: which assigned test is currently unlocked/active.
  testsDb.exec(`CREATE TABLE IF NOT EXISTS user_loop_state (
    user_id INTEGER PRIMARY KEY,
    active_test_id INTEGER,
    version_id INTEGER
  )`);

  // Append-only log of points earned per submitted step. Unlike test_results
  // (one row per step, upserted), this table grows on every submission so that
  // points accumulate across loop iterations and failures. Never cleared on loop advance.
  testsDb.exec(`CREATE TABLE IF NOT EXISTS points_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    test_id INTEGER,
    step_id INTEGER,
    points INTEGER,
    version_id INTEGER,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Admin-controlled "current version". Users perform tests for the active
  // version; every submission is tagged with it so per-version reporting is possible.
  // Only one version is flagged current at any time.
  testsDb.exec(`CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT,
    is_current INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Per-(user, test) loop-round counter. Each time a test is (re)entered by the
  // user (loop advance or manual restart), the round increments, so every
  // submission can be tagged with the unique round it belongs to.
  testsDb.exec(`CREATE TABLE IF NOT EXISTS user_test_rounds (
    user_id INTEGER,
    test_id INTEGER,
    round_no INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, test_id)
  )`);

  // Append-only audit ledger: one row per submitted step result. Unlike
  // test_results (one upserted row per step for loop logic), this keeps the FULL
  // history of every round's attempt — including result, comment, uploaded file,
  // version, and the unique round_id — so reports give a complete, round-aware
  // audit trail rather than only the latest attempt.
  testsDb.exec(`CREATE TABLE IF NOT EXISTS test_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    user_id INTEGER,
    test_id INTEGER,
    step_id INTEGER,
    result TEXT CHECK (result IN ('pass', 'fail')) NOT NULL,
    comment TEXT,
    config_file_path TEXT,
    version_id INTEGER,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

// Return the current loop-round number for a (user, test) pair, initialising it
// to 1 on first access.
function getRound(userId, testId) {
  const row = testsDb.prepare(
    'SELECT round_no FROM user_test_rounds WHERE user_id = ? AND test_id = ?'
  ).get(userId, testId);
  if (row) return row.round_no;
  testsDb.prepare(
    'INSERT OR IGNORE INTO user_test_rounds (user_id, test_id, round_no) VALUES (?, ?, 1)'
  ).run(userId, testId);
  return 1;
}

// Advance the loop-round counter for a (user, test) pair (called when the test is
// (re)entered via a loop advance or manual restart). Returns the new round number.
function bumpRound(userId, testId) {
  testsDb.prepare(
    `INSERT INTO user_test_rounds (user_id, test_id, round_no) VALUES (?, ?, 1)
     ON CONFLICT(user_id, test_id) DO UPDATE SET round_no = round_no + 1`
  ).run(userId, testId);
  const row = testsDb.prepare(
    'SELECT round_no FROM user_test_rounds WHERE user_id = ? AND test_id = ?'
  ).get(userId, testId);
  return row ? row.round_no : 1;
}

// Call initDB FIRST so the tables exist before any migration runs. Migrations
// previously ran before initDB and produced scary "no such table" errors in
// the logs (silently swallowed) on every cold start.
try {
  initDB();
} catch (err) {
  console.error('Failed to initialize database tables:', err);
}

// Migration: tag submissions with the version they were performed for.
try {
  const trCols = testsDb.prepare('PRAGMA table_info(test_results)').all();
  if (!trCols.some(c => c.name === 'version_id')) {
    testsDb.exec('ALTER TABLE test_results ADD COLUMN version_id INTEGER');
    console.log('Migration: added version_id column to test_results');
  }
  const plCols = testsDb.prepare('PRAGMA table_info(points_log)').all();
  if (!plCols.some(c => c.name === 'version_id')) {
    testsDb.exec('ALTER TABLE points_log ADD COLUMN version_id INTEGER');
    console.log('Migration: added version_id column to points_log');
  }
  const lsCols = testsDb.prepare('PRAGMA table_info(user_loop_state)').all();
  if (!lsCols.some(c => c.name === 'version_id')) {
    testsDb.exec('ALTER TABLE user_loop_state ADD COLUMN version_id INTEGER');
    console.log('Migration: added version_id column to user_loop_state');
  }
  const trCols2 = testsDb.prepare('PRAGMA table_info(test_results)').all();
  if (!trCols2.some(c => c.name === 'round_id')) {
    testsDb.exec('ALTER TABLE test_results ADD COLUMN round_id INTEGER');
    console.log('Migration: added round_id column to test_results');
  }
  const plCols2 = testsDb.prepare('PRAGMA table_info(points_log)').all();
  if (!plCols2.some(c => c.name === 'round_id')) {
    testsDb.exec('ALTER TABLE points_log ADD COLUMN round_id INTEGER');
    console.log('Migration: added round_id column to points_log');
  }
} catch (err) {
  console.error('Migration failed:', err);
}

// Migration: add points column to test_steps if it doesn't exist
try {
  const cols = testsDb.prepare('PRAGMA table_info(test_steps)').all();
  if (!cols.some(c => c.name === 'points')) {
    testsDb.exec('ALTER TABLE test_steps ADD COLUMN points INTEGER DEFAULT 10');
    console.log('Migration: added points column to test_steps');
  }
} catch (err) {
  console.error('Migration failed:', err);
}

module.exports = {
  usersDb,
  testsDb,
  initDB,
  getRound,
  bumpRound
};