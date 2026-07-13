# QualityCheck App Development Documentation

## Overview
QualityCheck is a quality assurance testing application that guides users through sequential test steps with mandatory compliance. Users must authenticate, complete tests in a specific order, and document failures with comments and configuration file uploads.

## Architecture Overview
```
QualityCheck/
├── server.js               # Express server entry point (root)
├── server/                 # Backend modules
│   ├── server.js           # Express server entry point (runs on port 4006 by default)
│   ├── db/                 # Database initialization and connection (db.js)
│   ├── googleDrive/        # Unused/partially implemented Google Drive sync (driveService.js)
│   ├── middleware/         # Express middlewares (auth.js)
│   ├── routes/             # API routes (auth, users, tests, test-results, reports, backup)
│   └── utils/              # Server-side helpers (dataDir.js — writable-directory resolver for Vercel)
├── src/                    # React frontend
│   ├── components/         # React UI components (Dashboard, TestExecution, AdminPanel, etc.)
│   ├── context/            # State contexts (AuthContext)
│   ├── constants.ts        # Frontend constants (like APP_VERSION)
│   └── App.tsx             # Main App entry point
├── uploads/                # Directory for uploaded compliance configuration files
├── public/                 # Static assets (Q.png, quickstor-logo.png, etc.)
├── qualitycheck.db         # SQLite database (generated at root on startup)
├── seed.js                 # Database seeding script (populates tests.db)
├── .env                    # Environment variables file
├── DEVELOPMENT.md          # This file
├── buildrun.md             # Detailed build and run instructions
└── rebuildrun.md           # Automation steps for rebuilding/restarting
```

> [!NOTE]
> There are two entry server files: `server.js` at the root and `server/server.js`. The official `package.json` scripts execute `server/server.js` (`npm run server`).

## User and Admin Roles (Role-Based Access)

The application supports two roles:
1. **User (Non-Admin)**:
   - Can only view and execute tests explicitly assigned to them.
   - Directed to the user dashboard (`/dashboard`).
2. **Admin**:
   - Directed to the admin panel (`/admin`).
   - Can manage users (create, delete, update roles). Deleting a user is a **hard, irreversible wipe**: the admin must confirm twice (acknowledge, then type the exact username), and the backend cascades the deletion across `user_sessions`, `test_results`, `points_log`, `test_assignments`, `user_loop_state`, the `users` row itself, **and every uploaded config file that user submitted** — leaving the system exactly as if the user was never added.
   - Can assign/unassign tests to/from users.
   - Can view user execution history and performance reports.
    - Can dynamically import new tests and steps from Excel spreadsheets (`.xlsx` or `.xls`).
     - Can backup and restore all application data (users, tests, results, assignments, and each user's per-loop state) via the **Backup / Restore** tab in the admin panel.
     - Backup exports a JSON file containing all database records (including `user_loop_state` and `user_test_rounds`, so each user's loop position/round and locked/unlocked status is preserved, plus the full `test_submissions` audit ledger). It also embeds every uploaded compliance config file that is still referenced by a `test_results` or `test_submissions` row (base64-encoded), so a restore reproduces the system exactly — including every round's comments and the files users uploaded on failed steps, which are written back to `uploads/`. Restore replaces all current data (and writes the embedded files) with the uploaded backup.

## Database Structure

The application has been unified to use a single database: **`qualitycheck.db`** (or a single cloud database on Turso).
- **Tables**: `users`, `user_sessions`, `tests`, `test_steps`, `test_results`, `test_submissions`, `test_assignments`, `user_loop_state`, `user_test_rounds`, `points_log`, `versions`
  - `test_assignments` table columns: `id`, `test_id`, `user_id`, `assigned_at` (ensuring unique mappings for test assignments).
  - `user_loop_state` table columns: `user_id` (PRIMARY KEY), `active_test_id` (the test currently unlocked for that user), `version_id` (the version under which the active test was started). This drives the sequential loop and version-change auto-end behavior described below.
  - `user_test_rounds` table columns: `user_id`, `test_id` (composite PRIMARY KEY), `round_no` (the current loop-round counter for that user+test; bumped each time the test is (re)entered).
  - `test_submissions` table columns: `id` (PK, the unique submission/round id), `round_id`, `user_id`, `test_id`, `step_id`, `result`, `comment`, `config_file_path`, `version_id`, `executed_at`. This is the **append-only audit ledger**: one row per submitted step result, so every loop round's attempt (with its comment, uploaded file, and round) is retained for complete, round-aware reporting. `test_results` keeps only the latest upserted row per step for loop logic; `round_id` is also carried on `test_results` and `points_log`.

## Sequential Test Loop (Per-User Locking)

Non-admin users must complete their assigned tests in a strict, sequential, repeating loop. The behavior is driven by the `user_loop_state` table (one row per user, storing `active_test_id`).

- When a user logs in, the dashboard shows **one card per assigned test**.
- Only the **current** test (matching `active_test_id`) is unlocked/clickable. Every other card is **dimmed and shows a 🔒 lock overlay**, visually signalling it cannot be run until the previous test in the loop is finished.
- The loop order is the assigned tests sorted by `test.id` (ascending).
- When a user **completes the current test** (all of its steps have a submitted result), the backend (`POST /api/tests/:id/complete`) locks that test again and unlocks the **next** test in the loop.
- A **hard stop** also advances the loop: if a user submits a **failed** result on a step whose `on_failure` is `stop`, the test ends immediately and the backend (`POST /api/tests/:id/end`) locks the test and unlocks the next one — even though the test was not fully completed. (A `continue` failure simply moves on to the next step.)
- After the **last** assigned test is completed (or hard-stopped), the loop **wraps around** and the **first** test unlocks again — this repeats endlessly (infinite loop).
- **Wrapped-around tests auto-restart**: when the loop returns to a test the user has already finished in a prior iteration, the test view opens **ready to be redone from step 1** (no manual Restart needed). Nothing is cleared — the previous `test_results` stay and each re-submission simply upserts its row and appends to `points_log`, so points **accumulate across every loop iteration** (e.g. looping the suite twice doubles the month's earned points). This is how users are "paid" per completed step regardless of how many times the loop repeats.
- The loop state is **per user**: each user has their own independent `active_test_id`, so two users can be at different points in the loop.
- The `GET /api/tests` endpoint augments each test object for non-admins with `locked`, `isActive`, and `completed` flags, plus `totalPoints` (sum of the test's step points). Admins receive all tests with `locked:false` (they see every card unlocked in the admin panel).
- Server-side guards ensure only the currently active test can be marked complete or ended, and the per-test **Restart** action re-opens the same test (`POST /api/tests/:id/activate`) without skipping ahead.
- **Hard stop is the default failure behavior.** New steps created via the admin panel or Excel import default to `on_failure = 'stop'`, and the `test_steps.on_failure` column default is `stop`. All pre-existing steps in the seed/DB were also converted to `stop`. An admin can still switch an individual step to `continue` in the Manage Test Steps tab if a non-fatal failure should let the user proceed.

## Points & Scoring

Each step carries a **points** value (`value` / `points` column in `test_steps`, kept in sync). Points are aggregated as follows:

- **Total points of a test** = sum of all its steps' points. Returned as `totalPoints` on each test object from `GET /api/tests`, and shown on the dashboard card and in the test view.
- **Points earned in a test (in-session display)** = sum of points for the steps from the first step up to (but not including) the **current** step. The test view shows this as **`Earned: xx/yy`** (earned so far / test total), so the user sees progress without the still-unearned remainder.
- **Grand total earned this month** = sum of points logged in the append-only `points_log` table for **every submitted step** since the 1st of the current month. Because the ledger grows on every submission (a `pass` **or** a `fail`, and on every loop iteration — including re-runs of the same test), points accumulate correctly instead of freezing at the last value when the loop wraps around. Provided by `GET /api/test-results/summary` (authenticated, returns `{ monthEarned, monthStart }`), which reads from `points_log`. It is displayed on the dashboard and in the test view, and refreshes after each submitted step so it advances immediately as the user passes/fails a step. (The per-step current-progress still lives in `test_results`, which is upserted so the loop/next-step logic sees exactly one result per step.)

> [!NOTE]
> "Earned" counts any attempted step (pass **or** fail). A hard-stopped test therefore includes the failed step's points, but steps after the stop are never aggregated because the user does not perform them.

## Versioning

- The application version is defined in `src/constants.ts` as `APP_VERSION` and is rendered in the footer via `src/components/VersionFooter.tsx`.
- The version is advanced manually in `src/constants.ts` after any coding is completed (i.e. before building the app).
- The correct order for any code change is:
  1. Make the code change.
  2. Advance the app version manually in `src/constants.ts`.
  3. Build the production bundle: `cmd.exe /c "npm run build"`.
  4. Restart the server and test locally.
  5. Commit and push the code changes.
- The version included at the time of the sequential per-user loop / `user_loop_state` backup work was **`1.0000003`**.
- The version at the time of the points-ledger (`points_log`), infinite-loop auto-redo, and hard-stop-default work was **`1.0000007`**.
- The version at the time of the **version-change auto-end** and **dashboard/header polling** work was **`1.0000019`**.
- The version at the time of the **admin multi-user reports with version filter** and **searchable user/version selectors** was **`1.0000020`**.
- The version at the time of the **test-centric admin report** with test selector and failed user/step breakdown was **`1.0000023`**.
- The version at the time of the **failure comment + file download in reports**, **backup including uploaded files**, and **cascade user deletion with double confirmation** was **`1.0000024`**.
- The version at the time of making each failed-step upload **uniquely related to its exact user/test/step** (filename carries `u{userId}-t{testId}-s{stepId}`, and a later-round re-failure replaces + deletes the previous file) was **`1.0000025`**.
- The version at the time of the **round-aware audit ledger** (`test_submissions` append-only table + per-(user,test) `user_test_rounds` counter + `round_id` on `test_results`/`points_log`, with reports, backup, and user-delete cascade covering the new tables) was **`1.0000026`**.
- The version at the time of fixing **round-aware test execution** (new rounds restart from step 1, `doneStepIds` filtered by `round_id`) and **round-aware reports** (one line per failed submission with individual download links and timestamps) was **`1.0000028`**.
- The version at the time of fixing **ESLint build errors for Vercel** (removed unused `updatePoints`, unused `user` in Dashboard, unused `useEffect` in LoginScreen) was **`1.0000030`**.
- The version at the time of making `initializeAdminUser` callable from server bootstrap and fixing `app.use('/api/auth', authRoutes.router)` was **`1.0000031`**.
- The version at the time of **forcing admin/admin reset on every server startup** (regardless of existing admin user state) to guarantee login works in production was **`1.0000037`**.
- The version at the time of **switching frontend to relative API URLs** and fixing CORS for multi-user/internet deployment was **`1.0000040`**.
- The version at the time of **bumping `engines.node` to `24.x` (Node 20 was deprecated on Vercel as of 2026 and would fail to build)**, **fixing the User/Test Report "Network error" caused by `new URL()` throwing on a path-only string**, and **redirecting SQLite + uploads to `/tmp` on Vercel (read-only `/var/task/`)** was **`1.0000047`**.
- The version at the time of **fixing the backup import 413 (Content Too Large) on Vercel** by adding **gzip compression + chunked upload** (3 MB per chunk, with new `/api/backup/import-chunk` and `/api/backup/import-finalize` endpoints, plus a small `dataDir`-aware cleanup), and **moving the SQLite migrations to run after `initDB()`** so the "no such table" error stops showing up in Vercel cold-start logs, was **`1.0000049`**.

The **Reports** tab in the admin panel provides per-user (or multi-user aggregated) reports
over a configurable date range, filtered by testing version.

- **Route**: `GET /api/reports/user-report` (admin only).
- **Parameters**: `userId` (single ID or comma-separated list), `startDate`, `endDate`, `versionId` (optional).
- **Response**:
  - `users`: array of `{ userId, userName }` for the requested users.
  - `startDate`, `endDate`, `versionId`.
  - `totalPointsEarned`, `totalSteps`.
  - `tests`: array of assigned tests with per-test summary (`rounds`, `passes`, `fails`)
    and `failedSubmissions` containing **every failed submission as a separate object**
    (`stepId`, `stepNumber`, `description`, `comment`, `configFilePath`, `roundId`, `executed_at`),
    so admins see one row per failure occurrence and can download each file independently.
- **Frontend UI** (`AdminPanel.tsx` Reports tab):
  - **User selector**: searchable combo box with checkboxes; selected users shown as removable tags.
  - **Version selector**: searchable combo box, defaults to the current version.
  - **Date presets**: Current Month, Last Month (default), Current Year, Last Year, Custom.
  - **Generate Report** button is disabled until at least one user and a version are selected.
  - Test cards are collapsed by default; clicking a card expands it to show **all failed submissions**,
    one table row per occurrence, with individual **Download** links, round, timestamp, comment,
    and uploaded config file. Passed steps are hidden.
- Reports are scoped to tests assigned to the selected users and only count activity within
  the chosen date range and version.

## Admin: Manage Test Steps

The **Manage Tests** tab in the admin panel lets an admin open any test and manage its steps in a table:

- **Edit step description** inline (what the user must do for that step).
- **Edit points** awarded per step (`value` / `points` column in `test_steps`).
- **Set failure behavior** per step via `on_failure`:
  - `continue` — a failed step lets the user proceed to the next step.
  - `stop` — a failed step hard-stops the entire test (user is returned to the dashboard). **This is the default** for new steps (see above).
- **Add a step** between existing steps (choose "After step N" or "At the end"); step numbers are re-sequenced automatically (1..n) after every insert/delete via the reorder endpoint.
- **Delete a step** (also re-sequences the remaining steps).

Backing endpoints (admin-authenticated) in `server/routes/tests.js`:
- `GET /api/tests/:id` — test with its steps (ordered by `step_number`).
- `POST /api/tests/:id/steps` — add a step.
- `PUT /api/tests/:id/steps/:stepId` — update description, points, and `on_failure`.
- `DELETE /api/tests/:id/steps/:stepId` — delete a step.
- `PUT /api/tests/:id/steps/reorder` — re-number steps sequentially.

> [!NOTE]
> The `test_steps` table stores points in two columns, `value` (original) and `points` (added by migration). All step writes keep the two columns in sync, so either can be treated as the points value.

## Key Values and Locations

### Configuration
- **App Root**: Any directory where the project is cloned (e.g. `C:\Users\moata\.gemini\antigravity\scratch\QualityCheck`).
- **Backend Port**: Configurable via `PORT` (or `PORT_API` if using `server/server.js`). Defaults to `4006`.
- **Frontend**: Served statically by the backend server on the configured port. The React app is **stateless and passive** for all business data: every mount/load fetches tests, results, rounds, and points summary fresh from the backend. The only client-side state is the JWT token (stored in `localStorage`) and transient UI state (form inputs, expanded panels). No test data, points, or results are cached in the browser, making this a safe multi-user solution when published on the internet.
- **Database Files**: Created in the project root directory as `qualitycheck.db` at runtime.

### Environment Variables
Create a `.env` file in the root directory:
```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
REDIRECT_URI=https://localhost:4006/callback
JWT_SECRET=your-super-secret-jwt-key-change-in-production
PORT=4006
PORT_API=4006
NODE_ENV=production
```

## Component Responsibilities

### Backend
- REST API endpoints for authentication, user management, tests, assignments, and results.
- SQLite database management using `better-sqlite3`.
- File upload handling using `multer`.
- Excel file processing and test ingestion using `xlsx` (SheetJS).
- JWT session management and authentication middleware.

### Frontend (src/)
- React components for UI (Dashboard for users, AdminPanel for admins).
- Authentication context for state management.
- API service layer communicating with `/api/...` using **relative URLs**. No hardcoded host, port, or absolute API base. All business data is fetched from the backend on every need; the frontend holds no test data, points, or results locally (the only persistent client state is the JWT token in `localStorage` for session reuse).

## Development Scripts
- `node seed.js`: Seed the database with sample tests and steps.
- `npm run server`: Start backend on the configured port.
- `npm start`: Start React dev server (port 3000 by default).
- `npm run build`: Build React app for production (creates the `build/` directory).
- `npm test`: Run tests.

## Google Drive Integration Status
> [!WARNING]
> The directory `server/googleDrive/` contains a partially implemented Google Drive sync service (`driveService.js`).
> This feature is currently **non-functional and disabled** because:
> 1. `driveService.js` is not imported anywhere in the backend server.
> 2. It contains broken imports (`const auth = require('./auth')` but `./auth` does not exist in the googleDrive directory).
> 3. No cron/scheduled jobs or auto-backups are configured.

## SPA Serving Note

> [!WARNING]
> The production server uses `fs.readFileSync` instead of `res.sendFile` for the SPA catch-all route. This is a workaround for an **Express 5 incompatibility** where `res.sendFile()` throws `NotFoundError` after `express.static()` fails to match a route. Do not revert this to `res.sendFile` unless the Express 5 bug is fixed.

## Rebuilding and Restarting on Port 4005

To rebuild the frontend and restart the backend application on port **4005**, follow these steps:

### 1. Stop Any Existing Processes on Port 4005
Before restarting, ensure no other instance is running on port 4005. Run the following command in PowerShell:
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 4005 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

### 2. Configure Environment Variables
Make sure your root `.env` file contains:
```env
PORT=4005
PORT_API=4005
NODE_ENV=production
```

### 3. Rebuild the React Frontend
Run the build:
```powershell
cmd.exe /c "npm run build"
```

### 4. Start/Restart the Backend Server
Start the Express server which automatically serves the newly built production bundle on port 4005:
```powershell
cmd.exe /c "node server/server.js"
```

> [!NOTE]
> The frontend uses **relative** API URLs (`/api/...`) by default. The server listens on `process.env.PORT_API || process.env.PORT || 4006`, which covers both local and Render's injected `PORT`.

---

> [!IMPORTANT]
> When restarting QualityCheck, **NEVER** use `Get-Process -Name "node" | Stop-Process -Force` or any command that kills all Node.js processes. Other apps (e.g., NexusERP) may be running on different ports. Always target only the QualityCheck server process (`server/server.js`) when stopping or restarting.

## Git Commit and Push Instructions

### Commit & Push Guidelines
If you need to commit and push changes back to the remote repository, use the following commands:
```powershell
# Stage changes
git add .

# Commit changes
git commit -m "Commit message describing the changes"

# Push to the origin branch (e.g., main)
git push origin main
```

> [!CAUTION]
> **CRITICAL RULE FOR AI ASSISTANTS:**
> **DO NOT** under any circumstances stage, commit, or push any changes to the remote git repository unless the user has **EXPLICITLY** and **CLEARLY** requested you to do so in their prompt. This is to avoid unintended code pushes or branching modifications.

---

## Deployment (Render.com)

The app is a single Node service: Express serves both the API and the React production build (same origin), so no separate frontend host is needed. A `render.yaml` (modeled on the sibling `NexusERP` app) is provided at the project root.

- **Build**: `npm install && npm run build`
- **Start**: `node server/server.js`
- **Port**: the server listens on `process.env.PORT_API || process.env.PORT || 4006` and binds `0.0.0.0`, so Render's injected `PORT` is used automatically.
- **API base**: the frontend uses **relative** API URLs (`/api/...`) by default, which works on any host with no extra config. CORS is set to `origin: true` to allow any authenticated cross-origin request.
- **Required env vars** (set in `render.yaml` / Render dashboard):
  - `NODE_ENV=production`
  - `JWT_SECRET` — set a strong random value (sessions are signed with it).
  - `NODE_VERSION` is pinned to `24` for `better-sqlite3` prebuilt binaries (Node 20 was deprecated as of 2026 and would fail to build on Vercel).
- **Google Drive** is disabled and ignored; no `GOOGLE_*` credentials are required.

### Ephemeral storage caveat
Render's filesystem is **ephemeral** — `users.db`, `tests.db`, and `uploads/` are created at runtime in the service root and are **lost on every deploy/restart**. The DBs are recreated empty (seed data is not auto-applied), so an admin must re-import tests and recreate users after a reset. For durable data, attach a Render **Disk** (persistent storage) mounted at the service root, or back up/restore via the admin Backup / Restore tab.

## Deployment (Vercel)

The same single Node service is deployed to Vercel via `vercel.json` at the project root. Two builds are wired up:

- `@vercel/static-build` reading `package.json`, output dir `build/` — produces the React production bundle.
- `@vercel/node` on `server/server.js` — the Express API.

Routes:
- `/api/*` → serverless function (`server/server.js`).
- `/*` → static assets in `build/`; real files (JS/CSS/images) are served directly, while unknown paths are rewritten to `index.html` via the catch-all route in `vercel.json` so the SPA can handle client-side routing on a browser refresh. (The SPA fallback is **not** automatic on Vercel — it must be wired explicitly with the `/(.*)` → `/index.html` rewrite; otherwise refreshing a deep route like `/dashboard` or `/admin` returns "page not found".)

- **Port**: Vercel injects `PORT`; the server listens on `process.env.PORT_API || process.env.PORT || 4006` and binds `0.0.0.0`.
- **Node version**: `engines.node` in `package.json` is pinned to `24.x`. Node 20 was deprecated on Vercel in 2026 and any project that still pins it (or has the project setting on 20.x) will fail to build with a hard error. If you have to change the Node version, update **both** the `engines` field in `package.json` **and** the dashboard setting in **Settings → General → Node.js Version**.
- **API base**: the frontend uses **relative** API URLs (`/api/...`) by default, so the same build works on localhost, a private IP, Render, or any Vercel domain with no extra config. CORS is `origin: true`.
- **Required env vars** (set in the Vercel dashboard, not in `.env`):
  - `NODE_ENV=production`
  - `JWT_SECRET` — set a strong random value (sessions are signed with it).
- **Google Drive** is disabled and ignored; no `GOOGLE_*` credentials are required.

### Vercel's read-only filesystem and the `dataDir` utility

Vercel serverless functions run with a **read-only** filesystem at `/var/task/` — the only writable location is `/tmp`, which is also **ephemeral** (wiped on every cold start and every redeploy). Anywhere the backend writes to disk — `qualitycheck.db` and `uploads/` — must therefore redirect to `/tmp` on Vercel. Locally those files live in the project root and everything works as-is.

This is centralised in **`server/utils/dataDir.js`**, which every writable path goes through:

```js
// server/utils/dataDir.js
const isVercel = !!process.env.VERCEL;
const dataDir  = isVercel ? '/tmp' : path.join(__dirname, '..', '..');
module.exports = { dataDir, isVercel };
```

Consumers:
- `server/db/db.js` — opens `qualitycheck.db` under `dataDir`.
- `server/server.js` — the `/uploads` static route reads from `dataDir/uploads` so files written by multer are served from the same place.
- `server/routes/test-results.js` — failed-step config uploads are written to `dataDir/uploads`.
- `server/routes/backup.js` — backup restore writes embedded files to `dataDir/uploads`; export reads from the same place.
- `server/routes/users.js` — cascade-delete on user removal unlinks files from `dataDir/uploads`.

> [!IMPORTANT]
> **When you add any new server-side code that writes to disk (database files, upload files, caches, logs, anything), always go through `dataDir` from `server/utils/dataDir.js`.** Do not hardcode a relative path like `'qualitycheck.db'` or `'../../uploads'` — those will work locally and silently crash on Vercel with `SQLITE_CANTOPEN` or `EROFS`. The `process.env.VERCEL` signal is the only thing distinguishing the two environments.

### Vercel ephemeral storage caveat

> [!WARNING]
> **Vercel's `/tmp` is wiped on every cold start and every redeploy.** This means all runtime data (`qualitycheck.db`, `uploads/`) is **lost** after inactivity (cold start) or after pushing a new deploy. You will see only the `admin` user — tests, assignments, results, and logs will all be gone.
>
> **Workaround:** After every cold start or deploy, the admin must restore via the Backup / Restore tab to bring all data back.

### Persistent storage on Vercel with Turso

For durable data on Vercel, the application has been fully migrated to support **[Turso](https://turso.tech)** (a cloud-hosted SQLite/libSQL service) out of the box.

The database layer in `server/db/db.js` operates in a hybrid mode:
- **Local Dev Mode**: Connects to a local SQLite file (`qualitycheck.db`) using `better-sqlite3` wrapped in an async-compatible interface.
- **Production Mode (Vercel)**: Automatically connects to your cloud-hosted Turso database using `@libsql/client` when the environment variables are set.

**Setup steps:**
1. Create a Turso account at [turso.tech](https://turso.tech)
2. Create a database: `turso db create qualitycheck`
3. Get the database URL and auth token: `turso db show qualitycheck`
4. Add the following Environment Variables in the Vercel dashboard (Settings → Environment Variables):
   - `TURSO_DATABASE_URL` = the `libsql://...` URL
   - `TURSO_AUTH_TOKEN` = the generated auth token
5. Commit and push the codebase. Vercel will automatically build the app and connect to your cloud database.

### Vercel's 4.5 MB request body limit and chunked backup import

Vercel serverless functions hard-cap the request body at **4.5 MB** on every plan. The admin **Backup / Restore** backup JSON is mostly base64-embedded user uploads, so a real backup with even a handful of files easily blows past that limit and the import POST returns `413 Content Too Large`.

To handle arbitrary backup sizes the restore flow is **gzip + chunked**:

- **Client** (`AdminPanel.tsx` → `handleBackupImport`): reads the file, gzips the JSON with the browser's native `CompressionStream`, splits the gzipped bytes into 3 MB chunks, and POSTs each chunk to `/api/backup/import-chunk` with `uploadId`, `chunkIndex`, and `totalChunks` form fields. Then it POSTs `/api/backup/import-finalize` with `{ uploadId, totalChunks }`.
- **Server** (`server/routes/backup.js`): the `/import-chunk` route writes each chunk to `dataDir/import-chunks/<uploadId>/<chunkIndex>`. The `/import-finalize` route reassembles the chunks in order, tries `zlib.gunzipSync` first (falling back to raw JSON), validates the structure, and applies it through the shared `applyBackup()` helper. Chunks are cleaned up on success and on any error path.
- **Single-request fallback**: the original `POST /api/backup/import` is kept and now accepts **gzipped or raw** JSON (auto-detected via the gzip magic bytes), so any consumer that still sends a single request — or a backup small enough to fit in 4.5 MB even uncompressed — keeps working.

The chunk size is 3 MB (well under the 4.5 MB Vercel limit even with multipart overhead) and the chunk directory is created on demand under `dataDir` so it works identically on local disk and on Vercel's `/tmp`. The `uploadId` is validated against a strict character class to prevent any path-traversal mischief.

## Security Notes
- Passwords are hashed using `bcrypt` / `bcryptjs`.
- Sessions are managed with JWT tokens.
- File uploads are validated for type and size.
- CORS is configured with `origin: true` so the frontend can be served from any origin for multi-user/internet deployment while still requiring authentication.
- **Admin bootstrap**: on every server startup, `initializeAdminUser()` ensures the `admin` user exists and resets its password to `admin`. This guarantees local and production access even if the database was restored or the user table was cleared.
- **`uploads/` is never committed.** The `uploads/` directory holds runtime user-uploaded compliance configuration files (submitted on failed steps) and is listed in `.gitignore` so it is always excluded from version control. These are user data, not source — do not add or force-add `uploads/` to the repo. The admin **backup does** bundle every referenced upload (base64 inside the backup JSON) so a restore reproduces the system exactly, including the failure attachments.

## Frontend Design: Stateless and Passive

The React frontend is intentionally kept stateless with respect to all business data:
- **No cached test data, points, or results.** Every mount/load refetches `tests`, `test_results`, `user_test_rounds`, and `points_log` summaries from the backend.
- **Relative API URLs only.** No hardcoded `localhost`, IP, or absolute URLs are baked into the build. The app works whether served on `localhost:4005`, a private IP, or a public Render/Vercel domain.
- **Single source of truth:** the SQLite databases (`users.db`, `tests.db`) owned by the backend. Multiple concurrent users/browsers all query the same backend state, so there is no client-side inconsistency.
- **Authentication token** is the only persistent client state (`localStorage`). All other state (`tests`, `steps`, `results`, `round`, `monthEarned`) is derived fresh from backend responses on each navigation/render.
- **`new URL()` requires a base in the browser.** Unlike in Node, the browser's `URL` constructor does **not** fall back to `window.location` as an implicit base when you pass a path-only string. `new URL('/api/foo')` throws `TypeError: Failed to construct 'URL': Invalid URL` even though the page is loaded from a valid origin. The fix is to pass `window.location.origin` explicitly as the second argument — `new URL('/api/foo', window.location.origin)` — or just use a plain template string (`\`${API_BASE}/api/foo\``) and let `fetch` resolve the path against the current page. The User/Test Report fetches in `AdminPanel.tsx` hit this bug; see the commit history around version `1.0000045`.