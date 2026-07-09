const Database = require('better-sqlite3');

// Users database
const usersDb = new Database('users.db', { filename: true });

// Tests database
const testsDb = new Database('tests.db', { filename: true });

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
    active_test_id INTEGER
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
} catch (err) {
  console.error('Migration failed:', err);
}

// Call initDB immediately to ensure tables are created on startup
try {
  initDB();
} catch (err) {
  console.error('Failed to initialize database tables:', err);
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
  initDB
};