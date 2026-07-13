const path = require('path');
const { dataDir } = require('../utils/dataDir');

// Initialize database modes.
// If process.env.TURSO_DATABASE_URL is set, connect to the remote Turso DB.
// Otherwise, fall back to a local file-based SQLite database.
const isTurso = !!process.env.TURSO_DATABASE_URL;
let client;
let localDb;

if (isTurso) {
  const { createClient } = require('@libsql/client/web');
  const dbUrl = process.env.TURSO_DATABASE_URL;
  console.log(`[Database] Connecting to: Turso Cloud (${dbUrl.substring(0, 15)}...)`);
  client = createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
} else {
  const Database = require('better-sqlite3');
  const dbPath = path.join(dataDir, 'qualitycheck.db');
  console.log(`[Database] Connecting to: Local File SQLite (${dbPath})`);
  localDb = new Database(dbPath, { filename: true });
  localDb.pragma('journal_mode = DELETE');
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

// Compatibility wrapper for usersDb and testsDb prepare/exec syntax.
const dbWrapper = {
  prepare(sql) {
    if (isTurso) {
      return {
        async all(...params) {
          await dbReady;
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const res = await client.execute({ sql, args });
          return res.rows;
        },
        async get(...params) {
          await dbReady;
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const res = await client.execute({ sql, args });
          return res.rows[0] || null;
        },
        async run(...params) {
          await dbReady;
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
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
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          return localDb.prepare(sql).all(...args);
        },
        get(...params) {
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          return localDb.prepare(sql).get(...args) || null;
        },
        run(...params) {
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
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
      is_admin BOOLEAN DEFAULT 0
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
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS test_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER,
      step_number INTEGER NOT NULL,
      description TEXT NOT NULL,
      success_symptom TEXT,
      value REAL DEFAULT 0,
      on_failure TEXT CHECK (on_failure IN ('continue', 'stop')) DEFAULT 'stop',
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
      user_id INTEGER PRIMARY KEY,
      active_test_id INTEGER,
      version_id INTEGER
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
    CREATE TABLE IF NOT EXISTS user_test_rounds (
      user_id INTEGER,
      test_id INTEGER,
      round_no INTEGER DEFAULT 1,
      PRIMARY KEY (user_id, test_id)
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
    )
  `.split(';')
   .map(s => s.trim())
   .filter(s => s.length > 0 && !s.startsWith('--'));

  if (statements.length > 0) {
    await clientWrapper.batch(statements, 'write');
  }
}

// Return the current loop-round number for a (user, test) pair, initialising it
// to 1 on first access.
async function getRound(userId, testId) {
  const row = await testsDb.prepare(
    'SELECT round_no FROM user_test_rounds WHERE user_id = ? AND test_id = ?'
  ).get(userId, testId);
  if (row) return row.round_no;
  await testsDb.prepare(
    'INSERT OR IGNORE INTO user_test_rounds (user_id, test_id, round_no) VALUES (?, ?, 1)'
  ).run(userId, testId);
  return 1;
}

// Advance the loop-round counter for a (user, test) pair. Returns the new round number.
async function bumpRound(userId, testId) {
  await testsDb.prepare(
    `INSERT INTO user_test_rounds (user_id, test_id, round_no) VALUES (?, ?, 1)
     ON CONFLICT(user_id, test_id) DO UPDATE SET round_no = round_no + 1`
  ).run(userId, testId);
  const row = await testsDb.prepare(
    'SELECT round_no FROM user_test_rounds WHERE user_id = ? AND test_id = ?'
  ).get(userId, testId);
  return row ? row.round_no : 1;
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

    const cols = (await clientWrapper.execute({ sql: 'PRAGMA table_info(test_steps)' })).rows;
    if (!cols.some(c => c.name === 'points')) {
      await clientWrapper.execute({ sql: 'ALTER TABLE test_steps ADD COLUMN points INTEGER DEFAULT 10' });
      console.log('Migration: added points column to test_steps');
    }
    console.log('[Database] Schema initialization and migrations completed successfully.');
  } catch (err) {
    console.error('Database migration/init failed:', err);
  }
}

// Run migrations/init immediately on load (async) and store the Promise
dbReady = runMigrations();

module.exports = {
  usersDb,
  testsDb,
  initDB,
  getRound,
  bumpRound
};