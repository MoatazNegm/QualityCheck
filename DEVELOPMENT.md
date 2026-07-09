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
│   └── routes/             # API routes (auth, users, tests, test-results, reports, backup)
├── src/                    # React frontend
│   ├── components/         # React UI components (Dashboard, TestExecution, AdminPanel, etc.)
│   ├── context/            # State contexts (AuthContext)
│   ├── constants.ts        # Frontend constants (like APP_VERSION)
│   └── App.tsx             # Main App entry point
├── uploads/                # Directory for uploaded compliance configuration files
├── public/                 # Static assets (Q.png, quickstor-logo.png, etc.)
├── users.db, tests.db      # SQLite databases (generated at root on startup)
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
   - Can manage users (create, delete, update roles).
   - Can assign/unassign tests to/from users.
   - Can view user execution history and performance reports.
    - Can dynamically import new tests and steps from Excel spreadsheets (`.xlsx` or `.xls`).
     - Can backup and restore all application data (users, tests, results, assignments, and each user's per-loop state) via the **Backup / Restore** tab in the admin panel.
     - Backup exports a JSON file containing all database records (including `user_loop_state`, so each user's loop position and locked/unlocked status is preserved). Restore replaces all current data with the uploaded backup.

## Database Structure

### Users Database (users.db)
- Stores user credentials and admin status.
- Tables: `users`, `user_sessions`

### Tests Database (tests.db)
- Stores test definitions, steps, results, user assignments, and per-user loop state.
- Tables: `tests`, `test_steps`, `test_results`, `test_assignments`, `user_loop_state`
  - `test_assignments` table columns: `id`, `test_id`, `user_id`, `assigned_at` (ensuring unique mappings for test assignments).
  - `user_loop_state` table columns: `user_id` (PRIMARY KEY), `active_test_id` (the test currently unlocked for that user). This drives the sequential loop described below.

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
- **The version now advances automatically** — you no longer run `node scripts/advance_version.js` by hand. A git **pre-commit hook** (`.githooks/pre-commit`, using `scripts/pre-commit.js`) bumps `APP_VERSION` by `0.0000001` (e.g. `1.0000002` → `1.0000003`) whenever a source file under `src/` or `server/` is committed, and stages the bumped `src/constants.ts` into that same commit. Pure docs/config commits (only `DEVELOPMENT.md`, `README.md`, `.env`, etc.) do **not** trigger a bump, and a commit that only touches `src/constants.ts` will not double-bump.
- The hook is activated by `git config core.hooksPath .githooks` (already set in this checkout). On a fresh clone, run that command once so the repo's tracked hook takes effect.
- Net effect: the version advances as soon as you change code and commit it, **before** the next rebuild/redeploy — so the deployed build always carries a fresh `APP_VERSION`. (The hook is a no-op during `npm run build` itself; the bump is produced at commit time and picked up by the subsequent build.)
- The version included at the time of the sequential per-user loop / `user_loop_state` backup work was **`1.0000003`**.
- The version at the time of the points-ledger (`points_log`), infinite-loop auto-redo, and hard-stop-default work was **`1.0000007`**.

## Testing Versions (Per-Version Tracking)

Admins define a **testing version** that users must run their tests against. This is a
separate concept from the build `APP_VERSION` (`src/constants.ts`) shown in the footer.

- Managed from the **Versions** tab in the admin panel (`src/components/AdminPanel.tsx`).
- Stored in the `versions` table (`tests.db`); exactly one row carries `is_current = 1`.
  The first version created automatically becomes current. `POST /api/versions/:id/set-current`
  switches the active version (unsetting the previous one inside a transaction).
- The current version name is displayed in the **top-center of the header**
  (`src/components/Header.tsx` via `GET /api/versions/current`) on every page.
- Every test submission is tagged with the current `version_id`:
  - `POST /api/test-results/:testId/steps/:stepId` writes `version_id` into `test_results`.
  - The same `version_id` is written into the append-only `points_log` on each submission.
- Both `test_results` and `points_log` gained a `version_id` column (added via migration
  in `server/db/db.js`; nullable so pre-existing rows are unaffected).
- Because each submission records its version, **per-version reports** can later aggregate
  pass/fail counts, number of tests done, and earned points simply by grouping on `version_id`.
- Backups (admin Backup / Restore tab) now include the `versions` table, and restores
  re-insert `version_id` for results/points.
- A version cannot be deleted while it still has logged results or points (to avoid
  orphaning per-version history); admins instead switch the current version.

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
- **Frontend**: Served statically by the backend server on the configured port.
- **Database Files**: Created in the project root directory as `users.db` and `tests.db` at runtime.

### Environment Variables
Create a `.env` file in the root directory:
```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
REDIRECT_URI=https://localhost:4006/callback
JWT_SECRET=your-super-secret-jwt-key-change-in-production
PORT=4006
PORT_API=4006
NODE_ENV=development
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
- API service layer communicating with `${API_BASE}/api/...` (configured via `REACT_APP_API_URL` environment variable during React build step).

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
REACT_APP_API_URL=http://localhost:4005
NODE_ENV=production
```

### 3. Rebuild the React Frontend
Set `REACT_APP_API_URL` and run the build:
```powershell
$env:REACT_APP_API_URL="http://localhost:4005"
cmd.exe /c "npm run build"
```

### 4. Start/Restart the Backend Server
Start the Express server which automatically serves the newly built production bundle on port 4005:
```powershell
cmd.exe /c "node server/server.js"
```

> [!NOTE]
> The `npm run build` step above produces the **same** production bundle that is deployed to Render.com. Because the frontend now defaults to **relative** API URLs (`REACT_APP_API_URL` falls back to `''`), the `REACT_APP_API_URL` line is optional — when omitted, the app calls `/api/...` on whatever host serves it (the local `:4005` instance or the Render URL). The local instructions keep it explicit for clarity. The server listens on `process.env.PORT_API || process.env.PORT || 4006`, so it binds to Render's injected `PORT` automatically with no change to this rebuild/restart flow.

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
- **API base**: the frontend uses **relative** API URLs (`/api/...`) by default (`REACT_APP_API_URL` falls back to `''`), which works on the Render URL/custom domain with no extra config.
- **Required env vars** (set in `render.yaml` / Render dashboard):
  - `NODE_ENV=production`
  - `JWT_SECRET` — set a strong random value (sessions are signed with it).
  - `NODE_VERSION` is pinned to `20` for `better-sqlite3` prebuilt binaries.
- **Google Drive** is disabled and ignored; no `GOOGLE_*` credentials are required.

### Ephemeral storage caveat
Render's filesystem is **ephemeral** — `users.db`, `tests.db`, and `uploads/` are created at runtime in the service root and are **lost on every deploy/restart**. The DBs are recreated empty (seed data is not auto-applied), so an admin must re-import tests and recreate users after a reset. For durable data, attach a Render **Disk** (persistent storage) mounted at the service root, or back up/restore via the admin Backup / Restore tab.

## Security Notes
- Passwords are hashed using `bcrypt` / `bcryptjs`.
- Sessions are managed with JWT tokens.
- File uploads are validated for type and size.
- CORS is configured to allow requests from local client development origins.
- **`uploads/` is never committed.** The `uploads/` directory holds runtime user-uploaded compliance configuration files (submitted on failed steps) and is listed in `.gitignore` so it is always excluded from version control. These are user data, not source — do not add or force-add `uploads/` to the repo. (Note: because `uploads/` is git-ignored, it is **not** included in admin backups; only DB records are backed up.)