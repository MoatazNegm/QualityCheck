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
    - Can backup and restore all application data (users, tests, results, assignments) via the **Backup / Restore** tab in the admin panel.
    - Backup exports a JSON file containing all database records. Restore replaces all current data with the uploaded backup.

## Database Structure

### Users Database (users.db)
- Stores user credentials and admin status.
- Tables: `users`, `user_sessions`

### Tests Database (tests.db)
- Stores test definitions, steps, results, and user assignments.
- Tables: `tests`, `test_steps`, `test_results`, `test_assignments`
  - `test_assignments` table columns: `id`, `test_id`, `user_id`, `assigned_at` (ensuring unique mappings for test assignments).

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

## Security Notes
- Passwords are hashed using `bcrypt` / `bcryptjs`.
- Sessions are managed with JWT tokens.
- File uploads are validated for type and size.
- CORS is configured to allow requests from local client development origins.