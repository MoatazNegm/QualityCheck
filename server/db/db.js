const path = require('path');
const fs = require('fs');
const { dataDir } = require('../utils/dataDir');

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bin': 'application/octet-stream'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Initialize database modes.
// If process.env.TURSO_DATABASE_URL is set, connect to the remote Turso DB.
// Otherwise, fall back to a local file-based SQLite database.
let isTurso = false;
let client;
let localDb;

const rawTursoUrl = process.env.TURSO_DATABASE_URL;

if (rawTursoUrl) {
  isTurso = true;
  let createClient;
  try {
    createClient = require('@libsql/client').createClient;
  } catch (e) {
    createClient = require('@libsql/client/web').createClient;
  }
  // Convert libsql:// to https:// to ensure web/fetch compatibility
  const dbUrl = rawTursoUrl.startsWith('libsql://')
    ? rawTursoUrl.replace(/^libsql:\/\//, 'https://')
    : rawTursoUrl;

  console.log(`[Database] Connecting to: Turso Cloud (${dbUrl.substring(0, 15)}...)`);
  client = createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
} else {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(dataDir, 'qualitycheck.db');
    console.log(`[Database] Connecting to: Local File SQLite (${dbPath})`);
    localDb = new Database(dbPath, { filename: true });
    localDb.pragma('journal_mode = DELETE');
  } catch (err) {
    console.warn('[Database] Native better-sqlite3 unavailable, falling back to @libsql/client file driver:', err.message);
    try {
      const { createClient } = require('@libsql/client');
      const dbPath = path.join(dataDir, 'qualitycheck.db');
      client = createClient({ url: `file:${dbPath}` });
      isTurso = true;
      console.log(`[Database] Connected via @libsql/client file driver (${dbPath})`);
    } catch (fallbackErr) {
      console.error('[Database] Failed to initialize SQLite drivers:', fallbackErr);
    }
  }
}

// A Promise to track when database initialization and migrations are completed.
let dbReady;

// An async compatibility wrapper around the database client/connection.
// Exposes the batch and transaction APIs of @libsql/client for both modes.
const clientWrapper = {
  async execute({ sql, args = [] }) {
    if (isTurso) {
      return await client.execute({ sql, args });
    } else {
      const stmt = localDb.prepare(sql);
      const isSelect = sql.trim().toLowerCase().startsWith('select') || sql.trim().toLowerCase().startsWith('pragma');
      if (isSelect) {
        const rows = stmt.all(...args);
        return { rows };
      } else {
        const res = stmt.run(...args);
        return {
          lastInsertRowid: res.lastInsertRowid,
          rowsAffected: res.changes
        };
      }
    }
  },

  async batch(statements, mode = 'write') {
    if (isTurso) {
      return await client.batch(statements, mode);
    } else {
      const tx = localDb.transaction(() => {
        const results = [];
        for (const stmt of statements) {
          let sqlStr, argsArr;
          if (typeof stmt === 'string') {
            sqlStr = stmt;
            argsArr = [];
          } else {
            sqlStr = stmt.sql;
            argsArr = stmt.args || [];
          }
          const s = localDb.prepare(sqlStr);
          const isSelect = sqlStr.trim().toLowerCase().startsWith('select') || sqlStr.trim().toLowerCase().startsWith('pragma');
          if (isSelect) {
            results.push({ rows: s.all(...argsArr) });
          } else {
            const res = s.run(...argsArr);
            results.push({
              lastInsertRowid: res.lastInsertRowid,
              rowsAffected: res.changes
            });
          }
        }
        return results;
      });
      return tx();
    }
  },

  async transaction(mode = 'write') {
    if (isTurso) {
      return await client.transaction(mode);
    } else {
      localDb.exec('BEGIN IMMEDIATE');
      let committed = false;
      return {
        async execute({ sql, args = [] }) {
          try {
            const stmt = localDb.prepare(sql);
            const isSelect = sql.trim().toLowerCase().startsWith('select') || sql.trim().toLowerCase().startsWith('pragma');
            if (isSelect) {
              return { rows: stmt.all(...args) };
            } else {
              const res = stmt.run(...args);
              return {
                lastInsertRowid: res.lastInsertRowid,
                rowsAffected: res.changes
              };
            }
          } catch (e) {
            if (!committed) {
              localDb.exec('ROLLBACK');
              committed = true;
            }
            throw e;
          }
        },
        async commit() {
          if (!committed) {
            localDb.exec('COMMIT');
            committed = true;
          }
        },
        async rollback() {
          if (!committed) {
            localDb.exec('ROLLBACK');
            committed = true;
          }
        }
      };
    }
  }
};

function normalizeParams(params) {
  const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return args.map(arg => {
    if (arg === undefined) return null;
    if (typeof arg === 'number' && !Number.isFinite(arg)) return null;
    return arg;
  });
}

// Compatibility wrapper for usersDb and testsDb prepare/exec syntax.
const dbWrapper = {
  prepare(sql) {
    if (isTurso) {
      return {
        async all(...params) {
          await dbReady;
          const args = normalizeParams(params);
          const res = await client.execute({ sql, args });
          return res.rows;
        },
        async get(...params) {
          await dbReady;
          const args = normalizeParams(params);
          const res = await client.execute({ sql, args });
          return res.rows[0] || null;
        },
        async run(...params) {
          await dbReady;
          const args = normalizeParams(params);
          const res = await client.execute({ sql, args });
          return {
            lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
            changes: res.rowsAffected
          };
        }
      };
    } else {
      return {
        all(...params) {
          const args = normalizeParams(params);
          return localDb.prepare(sql).all(...args);
        },
        get(...params) {
          const args = normalizeParams(params);
          return localDb.prepare(sql).get(...args) || null;
        },
        run(...params) {
          const args = normalizeParams(params);
          const res = localDb.prepare(sql).run(...args);
          return {
            lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
            changes: res.changes
          };
        }
      };
    }
  },
  async exec(sql) {
    await dbReady;
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    if (statements.length > 0) {
      await clientWrapper.batch(statements, 'write');
    }
  },
  client: clientWrapper,
  isTurso
};

// Map both database handles to the same wrapper
const usersDb = dbWrapper;
const testsDb = dbWrapper;

// Initialize tables in a single unified database
async function initDB() {
  const statements = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT 0,
      user_groups TEXT DEFAULT '["testers"]'
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      token TEXT UNIQUE,
      expires_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      is_deleted BOOLEAN DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS test_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER,
      step_number INTEGER NOT NULL,
      description TEXT NOT NULL,
      success_symptom TEXT DEFAULT 'N/A',
      value REAL DEFAULT 0,
      on_failure TEXT CHECK (on_failure IN ('continue', 'stop')) DEFAULT 'stop',
      attachment_path TEXT DEFAULT NULL,
      attachment_name TEXT DEFAULT NULL,
      FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS test_results (
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
    );
    CREATE TABLE IF NOT EXISTS test_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
      UNIQUE(test_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS user_loop_state (
      user_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL DEFAULT 1,
      active_test_id INTEGER,
      version_id INTEGER,
      PRIMARY KEY (user_id, app_id)
    );
    CREATE TABLE IF NOT EXISTS points_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      test_id INTEGER,
      step_id INTEGER,
      points INTEGER,
      version_id INTEGER,
      earned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      note TEXT,
      is_current INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_rounds (
      user_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL DEFAULT 1,
      round_no INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, app_id)
    );
    CREATE TABLE IF NOT EXISTS test_submissions (
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
    );
    CREATE TABLE IF NOT EXISTS user_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_round INTEGER NOT NULL,
      version_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS point_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      points_paid INTEGER NOT NULL,
      admin_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      drive_file_id TEXT,
      file_data TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'tester',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, app_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `.split(';')
   .map(s => s.trim())
   .filter(s => s.length > 0 && !s.startsWith('--'));

  if (statements.length > 0) {
    await clientWrapper.batch(statements, 'write');
  }

  // Composite indexes to prevent full table scans (critical for Turso row-read billing)
  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_test_submissions_user_test_exec ON test_submissions(user_id, test_id, executed_at)',
    'CREATE INDEX IF NOT EXISTS idx_test_submissions_user_result ON test_submissions(user_id, result)',
    'CREATE INDEX IF NOT EXISTS idx_points_log_user_test_earned ON points_log(user_id, test_id, earned_at)',
    'CREATE INDEX IF NOT EXISTS idx_points_log_earned_version ON points_log(earned_at, version_id)',
    'CREATE INDEX IF NOT EXISTS idx_test_results_user_test ON test_results(user_id, test_id)',
    'CREATE INDEX IF NOT EXISTS idx_test_results_version ON test_results(version_id)',
    'CREATE INDEX IF NOT EXISTS idx_test_steps_test ON test_steps(test_id)',
    'CREATE INDEX IF NOT EXISTS idx_test_assignments_user ON test_assignments(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_warnings_user_created ON user_warnings(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_point_payments_user ON point_payments(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_uploaded_files_filename ON uploaded_files(filename)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_apps_user ON user_apps(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_apps_app ON user_apps(app_id)'
  ];
  await clientWrapper.batch(indexStatements, 'write');
}

// Return the current loop-round number for a user, initialising it
// to 0 on first access. Round 0 means the user hasn't completed
// a full cycle through all assigned tests yet.
async function getRound(userId, appId = 1) {
  const cleanAppId = parseInt(appId, 10) || 1;
  const row = await testsDb.prepare(
    'SELECT round_no FROM user_rounds WHERE user_id = ? AND app_id = ?'
  ).get(userId, cleanAppId);
  if (row) return row.round_no;
  await testsDb.prepare(
    'INSERT OR IGNORE INTO user_rounds (user_id, app_id, round_no) VALUES (?, ?, 0)'
  ).run(userId, cleanAppId);
  return 0;
}

// Advance the loop-round counter for a user (called when wrapping
// around from the last test back to the first). Returns the new round number.
async function bumpRound(userId, appId = 1) {
  const cleanAppId = parseInt(appId, 10) || 1;
  const existing = await testsDb.prepare(
    'SELECT round_no FROM user_rounds WHERE user_id = ? AND app_id = ?'
  ).get(userId, cleanAppId);
  if (!existing) {
    await testsDb.prepare(
      'INSERT INTO user_rounds (user_id, app_id, round_no) VALUES (?, ?, 1) ON CONFLICT(user_id, app_id) DO UPDATE SET round_no = round_no + 1'
    ).run(userId, cleanAppId);
    return 1;
  } else {
    await testsDb.prepare(
      'UPDATE user_rounds SET round_no = round_no + 1 WHERE user_id = ? AND app_id = ?'
    ).run(userId, cleanAppId);
    return existing.round_no + 1;
  }
}

// Perform migrations asynchronously using clientWrapper to prevent deadlocks
async function runMigrations() {
  try {
    await initDB();

    const trCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(test_results)' })).rows;
    if (!trCols.some(c => c.name === 'version_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_results ADD COLUMN version_id INTEGER' });
      console.log('Migration: added version_id column to test_results');
    }
    const plCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(points_log)' })).rows;
    if (!plCols.some(c => c.name === 'version_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE points_log ADD COLUMN version_id INTEGER' });
      console.log('Migration: added version_id column to points_log');
    }
    const lsCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(user_loop_state)' })).rows;
    if (!lsCols.some(c => c.name === 'version_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE user_loop_state ADD COLUMN version_id INTEGER' });
      console.log('Migration: added version_id column to user_loop_state');
    }
    const trCols2 = (await clientWrapper.execute({ sql: 'PRAGMA table_info(test_results)' })).rows;
    if (!trCols2.some(c => c.name === 'round_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_results ADD COLUMN round_id INTEGER' });
      console.log('Migration: added round_id column to test_results');
    }
    const plCols2 = (await clientWrapper.execute({ sql: 'PRAGMA table_info(points_log)' })).rows;
    if (!plCols2.some(c => c.name === 'round_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE points_log ADD COLUMN round_id INTEGER' });
      console.log('Migration: added round_id column to points_log');
    }
    const uwCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(user_warnings)' })).rows;
    if (!uwCols.some(c => c.name === 'version_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE user_warnings ADD COLUMN version_id INTEGER' });
      console.log('Migration: added version_id column to user_warnings');
    }
    const tsCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(test_submissions)' })).rows;
    if (tsCols.length > 0 && !tsCols.some(c => c.name === 'version_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_submissions ADD COLUMN version_id INTEGER' });
      console.log('Migration: added version_id column to test_submissions');
    }

    // Now safely create indexes on columns that may have just been migrated
    await clientWrapper.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_user_warnings_user_version ON user_warnings(user_id, version_id, created_at)' });

    const cols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(test_steps)' })).rows;
    if (!cols.some(c => c.name === 'points')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_steps ADD COLUMN points INTEGER DEFAULT 10' });
      console.log('Migration: added points column to test_steps');
    }
    if (!cols.some(c => c.name === 'success_symptom')) {
      await clientWrapper.execute({ sql: "ALTER TABLE test_steps ADD COLUMN success_symptom TEXT DEFAULT 'N/A'" });
      console.log('Migration: added success_symptom column to test_steps');
    }
    if (!cols.some(c => c.name === 'attachment_path')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_steps ADD COLUMN attachment_path TEXT DEFAULT NULL' });
      console.log('Migration: added attachment_path column to test_steps');
    }
    if (!cols.some(c => c.name === 'attachment_name')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_steps ADD COLUMN attachment_name TEXT DEFAULT NULL' });
      console.log('Migration: added attachment_name column to test_steps');
    }
    await clientWrapper.execute({
      sql: "UPDATE test_steps SET success_symptom = 'N/A' WHERE success_symptom IS NULL OR TRIM(success_symptom) = ''"
    });

    const testCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(tests)' })).rows;
    if (!testCols.some(c => c.name === 'is_deleted')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE tests ADD COLUMN is_deleted BOOLEAN DEFAULT 0' });
      console.log('Migration: added is_deleted column to tests');
    }
    await clientWrapper.execute({
      sql: 'UPDATE tests SET is_deleted = 0 WHERE is_deleted IS NULL'
    });
    const userCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(users)' })).rows;
    if (!userCols.some(c => c.name === 'is_suspended')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0' });
      console.log('Migration: added is_suspended column to users');
    }
    const userGroupsCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(users)' })).rows;
    if (!userGroupsCols.some(c => c.name === 'user_groups')) {
      await clientWrapper.execute({ sql: "ALTER TABLE users ADD COLUMN user_groups TEXT DEFAULT '[\"testers\"]'" });
      console.log('Migration: added user_groups column to users');
    }

    // Backfill user_groups for existing users without proper groups
    const backfillUsers = await clientWrapper.execute({ sql: 'SELECT id, is_admin FROM users WHERE user_groups IS NULL OR user_groups = \'\' OR user_groups = \'[]\'' });
    for (const u of backfillUsers.rows) {
      const groups = u.is_admin ? JSON.stringify(['admins']) : JSON.stringify(['testers']);
      await clientWrapper.execute({ sql: 'UPDATE users SET user_groups = ? WHERE id = ?', args: [groups, u.id] });
    }

    // Migrate user_test_rounds (per-test counter) to user_rounds (per-user cycle counter)
    const oldTableCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(user_test_rounds)' })).rows;
    if (oldTableCols.length > 0) {
      // Create user_rounds for all users with round_no = 0 (they haven't completed a full cycle yet)
      await clientWrapper.execute({ sql: 'INSERT OR IGNORE INTO user_rounds (user_id, round_no) SELECT DISTINCT user_id, 0 FROM user_test_rounds' });
      await clientWrapper.execute({ sql: 'DROP TABLE user_test_rounds' });
      console.log('Migration: replaced user_test_rounds with user_rounds');
    }

    // Seed default consecutive failure threshold setting (180s = 3 minutes) if not present
    const hasSetting = await clientWrapper.execute({
      sql: "SELECT 1 FROM settings WHERE key = 'consecutive_failure_threshold_seconds' LIMIT 1"
    });
    if (hasSetting.rows.length === 0) {
      await clientWrapper.execute({
        sql: "INSERT INTO settings (key, value, description) VALUES ('consecutive_failure_threshold_seconds', '180', 'Consecutive Cross-Test Failure Time Threshold in seconds (default 3 minutes = 180 seconds)')"
      });
      console.log('Seeded default consecutive failure threshold setting (180s = 3 minutes)');
    }

    // Seed default maximum test rounds per month setting (8 rounds) if not present
    const hasMaxRoundsSetting = await clientWrapper.execute({
      sql: "SELECT 1 FROM settings WHERE key = 'max_monthly_test_rounds' LIMIT 1"
    });
    if (hasMaxRoundsSetting.rows.length === 0) {
      await clientWrapper.execute({
        sql: "INSERT INTO settings (key, value, description) VALUES ('max_monthly_test_rounds', '8', 'Maximum test rounds per month allowed per test per user (default 8 rounds)')"
      });
      console.log('Seeded default max_monthly_test_rounds setting (8 rounds)');
    }

    // Ensure uploaded_files table and indexes exist
    await clientWrapper.execute({
      sql: `CREATE TABLE IF NOT EXISTS uploaded_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        file_size INTEGER,
        drive_file_id TEXT,
        file_data TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    });
    await clientWrapper.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_uploaded_files_filename ON uploaded_files(filename)'
    });

    const ufCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(uploaded_files)' })).rows;
    if (!ufCols.some(c => c.name === 'dropbox_file_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE uploaded_files ADD COLUMN dropbox_file_id TEXT' });
      console.log('[Database] Added dropbox_file_id column to uploaded_files');
    }

    await clientWrapper.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_uploaded_files_dropbox_id ON uploaded_files(dropbox_file_id)'
    });

    // Ensure api_keys table and indexes exist
    await clientWrapper.execute({
      sql: `CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'tester',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    });
    await clientWrapper.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)'
    });
    await clientWrapper.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)'
    });

    const defaultSettings = [
      { key: 'dropbox_enabled', value: 'false' },
      { key: 'dropbox_app_key', value: '' },
      { key: 'dropbox_app_secret', value: '' },
      { key: 'dropbox_refresh_token', value: '' },
      { key: 'dropbox_folder_path', value: '/QualityCheck_Uploads' }
    ];

    for (const setting of defaultSettings) {
      const existing = await clientWrapper.execute({
        sql: 'SELECT 1 FROM settings WHERE key = ? LIMIT 1',
        args: [setting.key]
      });
      if (existing.rows.length === 0) {
        await clientWrapper.execute({
          sql: 'INSERT INTO settings (key, value) VALUES (?, ?)',
          args: [setting.key, setting.value]
        });
        console.log(`[Database] Seeded default ${setting.key} setting (${setting.value})`);
      }
    }

    // Backfill any existing files from uploads directory into uploaded_files table
    const uploadDir = path.join(dataDir, 'uploads');
    if (fs.existsSync(uploadDir)) {
      try {
        const diskFiles = fs.readdirSync(uploadDir);
        for (const fileName of diskFiles) {
          if (fileName.startsWith('configFile-') || fileName.endsWith('.zip') || fileName.endsWith('.pdf') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv') || fileName.endsWith('.docx') || fileName.endsWith('.jpg') || fileName.endsWith('.png')) {
            try {
              const exists = await clientWrapper.execute({
                sql: 'SELECT 1 FROM uploaded_files WHERE filename = ? LIMIT 1',
                args: [fileName]
              });
              if (exists.rows.length === 0) {
                const absPath = path.join(uploadDir, fileName);
                const stat = fs.statSync(absPath);
                if (stat.isFile()) {
                  const buf = fs.readFileSync(absPath);
                  const b64 = buf.toString('base64');
                  await clientWrapper.execute({
                    sql: `INSERT OR IGNORE INTO uploaded_files (filename, original_name, mime_type, file_size, file_data, uploaded_at)
                          VALUES (?, ?, ?, ?, ?, ?)`,
                    args: [fileName, fileName, getMimeType(fileName), buf.length, b64, stat.mtime.toISOString()]
                  });
                  console.log(`[Database] Backfilled upload file into uploaded_files table: ${fileName}`);
                }
              }
            } catch (fileErr) {
              console.warn(`[Database] Failed to backfill file ${fileName}:`, fileErr.message);
            }
          }
        }
      } catch (dirErr) {
        console.warn('[Database] Failed to read uploads directory for backfill:', dirErr.message);
      }
    }

    // Multi-app migrations
    // 1. Ensure 'apps' table exists and seed initial default app 'TopStor'
    await clientWrapper.execute({
      sql: `CREATE TABLE IF NOT EXISTS apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    });
    const defaultApp = await clientWrapper.execute({
      sql: 'SELECT 1 FROM apps WHERE id = 1 OR name = ? LIMIT 1',
      args: ['TopStor']
    });
    if (defaultApp.rows.length === 0) {
      await clientWrapper.execute({
        sql: "INSERT INTO apps (id, name, description) VALUES (1, 'TopStor', 'TopStor Storage System')",
        args: []
      });
      console.log('[Database] Seeded default app: TopStor (id=1)');
    }

    // 2. Ensure 'user_apps' table exists
    await clientWrapper.execute({
      sql: `CREATE TABLE IF NOT EXISTS user_apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        app_id INTEGER NOT NULL,
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, app_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
      )`
    });
    // Legacy migration: ONLY if user_apps was completely empty, assign admin (user 1) to app 1
    const existingUserApps = (await clientWrapper.execute({ sql: 'SELECT COUNT(*) as count FROM user_apps' })).rows[0];
    const uCount = existingUserApps ? Number(existingUserApps.count || existingUserApps.COUNT || 0) : 0;
    if (uCount === 0) {
      await clientWrapper.execute({
        sql: 'INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (1, 1)'
      });
    }

    // Data isolation migration: ensure NexusERP tests (48..52) and ERP users are properly isolated
    try {
      const erpAppRow = (await clientWrapper.execute({ sql: "SELECT id FROM apps WHERE LOWER(name) LIKE '%erp%' LIMIT 1" })).rows[0];
      const erpAppId = erpAppRow ? Number(erpAppRow.id) : 10;

      // Update tests 44..52 (S01..S09) to erpAppId
      await clientWrapper.execute({
        sql: `UPDATE tests SET app_id = ? WHERE id IN (44, 45, 46, 47, 48, 49, 50, 51, 52)`,
        args: [erpAppId]
      });
      await clientWrapper.execute({
        sql: `UPDATE test_results SET app_id = ? WHERE test_id IN (44, 45, 46, 47, 48, 49, 50, 51, 52)`,
        args: [erpAppId]
      });
      await clientWrapper.execute({
        sql: `UPDATE test_submissions SET app_id = ? WHERE test_id IN (44, 45, 46, 47, 48, 49, 50, 51, 52)`,
        args: [erpAppId]
      });

      // Find ERP users (30, 31, 32 or username containing ERP)
      const erpUsers = (await clientWrapper.execute({
        sql: "SELECT id FROM users WHERE LOWER(username) LIKE '%erp%' OR id IN (30, 31, 32)"
      })).rows;

      for (const u of erpUsers) {
        const uid = Number(u.id);
        // Remove rogue TopStor assignment
        await clientWrapper.execute({
          sql: 'DELETE FROM user_apps WHERE user_id = ? AND app_id = 1',
          args: [uid]
        });
        // Ensure assigned to erpAppId
        await clientWrapper.execute({
          sql: 'INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)',
          args: [uid, erpAppId]
        });
        // Ensure not global admin (is_admin = 0)
        await clientWrapper.execute({
          sql: 'UPDATE users SET is_admin = 0 WHERE id = ?',
          args: [uid]
        });
        // Update API keys to erpAppId
        await clientWrapper.execute({
          sql: 'UPDATE api_keys SET app_id = ? WHERE user_id = ?',
          args: [erpAppId, uid]
        });
        // Remove TopStor test assignments
        await clientWrapper.execute({
          sql: `DELETE FROM test_assignments WHERE user_id = ? AND test_id IN (SELECT id FROM tests WHERE app_id = 1)`,
          args: [uid]
        });
        // Assign active ERP tests (non-deleted only)
        const erpActiveTests = (await clientWrapper.execute({
          sql: 'SELECT id FROM tests WHERE app_id = ? AND COALESCE(is_deleted, 0) = 0',
          args: [erpAppId]
        })).rows;
        for (const t of erpActiveTests) {
          await clientWrapper.execute({
            sql: 'INSERT OR IGNORE INTO test_assignments (test_id, user_id) VALUES (?, ?)',
            args: [Number(t.id), uid]
          });
        }
      }
      // Remove assignments pointing to any deleted/disabled tests
      await clientWrapper.execute({
        sql: `DELETE FROM test_assignments WHERE test_id IN (SELECT id FROM tests WHERE COALESCE(is_deleted, 0) = 1)`
      });
      // Remove tests of erpAppId from users not in erpAppId
      await clientWrapper.execute({
        sql: `DELETE FROM test_assignments WHERE test_id IN (SELECT id FROM tests WHERE app_id = ?) AND user_id NOT IN (SELECT user_id FROM user_apps WHERE app_id = ?)`,
        args: [erpAppId, erpAppId]
      });
      console.log('[Database] NexusERP tests and user isolation migration verified successfully');
    } catch (migErr) {
      console.warn('[Database] Isolation data migration notice:', migErr.message);
    }

    // 3. Ensure app_id column exists on tests
    const testsColumns = (await clientWrapper.execute({ sql: 'PRAGMA table_info(tests)' })).rows;
    if (!testsColumns.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE tests ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to tests');
    }
    await clientWrapper.execute({ sql: 'UPDATE tests SET app_id = 1 WHERE app_id IS NULL' });

    // 4. Ensure app_id column exists on versions
    const verColumns = (await clientWrapper.execute({ sql: 'PRAGMA table_info(versions)' })).rows;
    if (!verColumns.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE versions ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to versions');
    }
    await clientWrapper.execute({ sql: 'UPDATE versions SET app_id = 1 WHERE app_id IS NULL' });

    // 5. Ensure app_id column exists on test_results
    const trColsApp = (await clientWrapper.execute({ sql: 'PRAGMA table_info(test_results)' })).rows;
    if (!trColsApp.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_results ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to test_results');
    }
    await clientWrapper.execute({ sql: 'UPDATE test_results SET app_id = 1 WHERE app_id IS NULL' });

    // 6. Ensure app_id column exists on test_submissions
    const tsColsApp = (await clientWrapper.execute({ sql: 'PRAGMA table_info(test_submissions)' })).rows;
    if (tsColsApp.length > 0 && !tsColsApp.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_submissions ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to test_submissions');
    }
    await clientWrapper.execute({ sql: 'UPDATE test_submissions SET app_id = 1 WHERE app_id IS NULL' });

    // 7. Ensure app_id column exists on points_log
    const plColsApp = (await clientWrapper.execute({ sql: 'PRAGMA table_info(points_log)' })).rows;
    if (!plColsApp.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE points_log ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to points_log');
    }
    await clientWrapper.execute({ sql: 'UPDATE points_log SET app_id = 1 WHERE app_id IS NULL' });

    // 8. Ensure app_id column exists on user_warnings
    const uwColsApp = (await clientWrapper.execute({ sql: 'PRAGMA table_info(user_warnings)' })).rows;
    if (uwColsApp.length > 0 && !uwColsApp.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE user_warnings ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to user_warnings');
    }
    await clientWrapper.execute({ sql: 'UPDATE user_warnings SET app_id = 1 WHERE app_id IS NULL' });

    // 9. Ensure app_id column and composite PRIMARY KEY (user_id, app_id) exist on user_rounds
    const urColsApp = (await clientWrapper.execute({ sql: 'PRAGMA table_info(user_rounds)' })).rows;
    const isUrComposite = urColsApp.filter(c => c.pk > 0).length > 1;
    if (!isUrComposite) {
      await clientWrapper.execute({
        sql: `CREATE TABLE IF NOT EXISTS user_rounds_new (
          user_id INTEGER NOT NULL,
          app_id INTEGER NOT NULL DEFAULT 1,
          round_no INTEGER DEFAULT 0,
          PRIMARY KEY (user_id, app_id)
        )`
      });
      await clientWrapper.execute({
        sql: `INSERT OR IGNORE INTO user_rounds_new (user_id, app_id, round_no)
              SELECT user_id, COALESCE(app_id, 1), round_no FROM user_rounds`
      });
      await clientWrapper.execute({
        sql: `INSERT OR REPLACE INTO user_rounds_new (user_id, app_id, round_no)
              SELECT user_id, app_id, COALESCE(MAX(round_id), 0)
              FROM test_results
              WHERE app_id IS NOT NULL
              GROUP BY user_id, app_id`
      });
      await clientWrapper.execute({ sql: 'DROP TABLE user_rounds' });
      await clientWrapper.execute({ sql: 'ALTER TABLE user_rounds_new RENAME TO user_rounds' });
      console.log('[Database] Migrated user_rounds to composite PRIMARY KEY (user_id, app_id)');
    }
    await clientWrapper.execute({ sql: 'UPDATE user_rounds SET app_id = 1 WHERE app_id IS NULL' });

    // 10. Ensure app_id column and composite PRIMARY KEY (user_id, app_id) exist on user_loop_state
    const ulsColsApp = (await clientWrapper.execute({ sql: 'PRAGMA table_info(user_loop_state)' })).rows;
    const isUlsComposite = ulsColsApp.filter(c => c.pk > 0).length > 1;
    if (!isUlsComposite) {
      await clientWrapper.execute({
        sql: `CREATE TABLE IF NOT EXISTS user_loop_state_new (
          user_id INTEGER NOT NULL,
          app_id INTEGER NOT NULL DEFAULT 1,
          active_test_id INTEGER,
          version_id INTEGER,
          PRIMARY KEY (user_id, app_id)
        )`
      });
      await clientWrapper.execute({
        sql: `INSERT OR IGNORE INTO user_loop_state_new (user_id, app_id, active_test_id, version_id)
              SELECT user_id, COALESCE(app_id, 1), active_test_id, version_id FROM user_loop_state`
      });
      await clientWrapper.execute({ sql: 'DROP TABLE user_loop_state' });
      await clientWrapper.execute({ sql: 'ALTER TABLE user_loop_state_new RENAME TO user_loop_state' });
      console.log('[Database] Migrated user_loop_state to composite PRIMARY KEY (user_id, app_id)');
    }
    await clientWrapper.execute({ sql: 'UPDATE user_loop_state SET app_id = 1 WHERE app_id IS NULL' });

    // 11. Ensure app_id column exists on point_payments
    const ppColsApp = (await clientWrapper.execute({ sql: 'PRAGMA table_info(point_payments)' })).rows;
    if (ppColsApp.length > 0 && !ppColsApp.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE point_payments ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to point_payments');
    }
    await clientWrapper.execute({ sql: 'UPDATE point_payments SET app_id = 1 WHERE app_id IS NULL' });

    // 12. Ensure is_suspended, is_deleted, deleted_at, suspended_at columns exist on apps
    const appsCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(apps)' })).rows;
    if (!appsCols.some(c => c.name === 'is_suspended')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE apps ADD COLUMN is_suspended INTEGER DEFAULT 0' });
      console.log('[Database] Added is_suspended column to apps');
    }
    if (!appsCols.some(c => c.name === 'is_deleted')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE apps ADD COLUMN is_deleted INTEGER DEFAULT 0' });
      console.log('[Database] Added is_deleted column to apps');
    }
    if (!appsCols.some(c => c.name === 'deleted_at')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE apps ADD COLUMN deleted_at DATETIME' });
      console.log('[Database] Added deleted_at column to apps');
    }
    if (!appsCols.some(c => c.name === 'suspended_at')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE apps ADD COLUMN suspended_at DATETIME' });
      console.log('[Database] Added suspended_at column to apps');
    }
    await clientWrapper.execute({ sql: 'UPDATE apps SET is_suspended = 0 WHERE is_suspended IS NULL' });
    await clientWrapper.execute({ sql: 'UPDATE apps SET is_deleted = 0 WHERE is_deleted IS NULL' });

    // 13. Ensure app_id column exists on api_keys
    const akCols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(api_keys)' })).rows;
    if (!akCols.some(c => c.name === 'app_id')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE api_keys ADD COLUMN app_id INTEGER DEFAULT 1' });
      console.log('[Database] Added app_id column to api_keys');
    }
    await clientWrapper.execute({ sql: 'UPDATE api_keys SET app_id = 1 WHERE app_id IS NULL' });
    await clientWrapper.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_api_keys_app_id ON api_keys(app_id)' });

    // Indexes for multi-app queries
    await clientWrapper.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_tests_app_id ON tests(app_id)' });
    await clientWrapper.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_versions_app_id ON versions(app_id)' });
    await clientWrapper.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_test_results_app_id ON test_results(app_id)' });
    await clientWrapper.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_points_log_app_id ON points_log(app_id)' });

    // 14. Retroactively restore zeroed points and clean up warnings for automated API key agents
    await clientWrapper.execute({
      sql: `UPDATE points_log
            SET points = (SELECT COALESCE(ts.points, ts.value, 1) FROM test_steps ts WHERE ts.id = points_log.step_id)
            WHERE points = 0 AND user_id IN (SELECT user_id FROM api_keys)`
    });
    await clientWrapper.execute({
      sql: `DELETE FROM user_warnings WHERE user_id IN (SELECT user_id FROM api_keys)`
    });

    console.log('[Database] Schema initialization and migrations completed successfully.');
  } catch (err) {
    console.error('Database migration/init failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Lightweight in-memory cache for rarely-changing data.
// Avoids repeated DB reads for values that change only on explicit admin actions.
// Each entry has an optional TTL (default: no expiry, invalidated on write).
// ---------------------------------------------------------------------------
const _cacheStore = {};
const cache = {
  get(key) {
    const entry = _cacheStore[key];
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      delete _cacheStore[key];
      return undefined;
    }
    return entry.value;
  },
  set(key, value, ttlMs) {
    _cacheStore[key] = {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null
    };
  },
  invalidate(key) {
    delete _cacheStore[key];
  },
  invalidatePrefix(prefix) {
    for (const key of Object.keys(_cacheStore)) {
      if (key.startsWith(prefix)) delete _cacheStore[key];
    }
  },
  clear() {
    for (const key of Object.keys(_cacheStore)) delete _cacheStore[key];
  }
};

// Run migrations/init immediately on load (async) and store the Promise
dbReady = runMigrations();

module.exports = {
  usersDb,
  testsDb,
  dbReady,
  initDB,
  getRound,
  bumpRound,
  cache
};