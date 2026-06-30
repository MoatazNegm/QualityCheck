# Build & Run Instructions

## Overview
The QualityCheck application is designed to run exclusively on port 4006. The Express backend serves both the API and the React frontend, eliminating port conflicts.

## Prerequisites
- Node.js v18+ installed
- npm v9+ installed
- Google Drive API credentials configured
- Port 4006 must be available

## Setup

### 1. Install Dependencies
```bash
cd C:\qualitycheck
npm install
```

### 2. Configure Environment
Create `.env` file in C:\qualitycheck:
```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
REDIRECT_URI=https://localhost:4006/callback
JWT_SECRET=your-super-secret-jwt-key-change-in-production
PORT=4006
NODE_ENV=development
```

### 3. Close Conflicting Applications
Before running, ensure no other applications are using port 4006:
```bash
netstat -ano | findstr :4006
# If process found, kill it (replace PID):
taskkill /PID <PID> /F
```

## Running the Application

### Development Mode
```bash
cd C:\qualitycheck
npm run server
```
This starts the Express backend which serves:
- API endpoints at http://localhost:4006/api/
- React frontend at http://localhost:4006/

### Production Build
```bash
cd C:\qualitycheck
npm run build
npm run server
```

## Access the Application
- **Application URL**: http://localhost:4006
- **API Health Check**: http://localhost:4006/api/health

## Project Structure
```
C:\qualitycheck\
├── server.js            # Express backend
├── .env                 # Environment variables
├── package.json
├── server/              # Backend modules
│   ├── routes/
│   ├── db/
│   ├── googleDrive/
│   └── middleware/
├── src/                 # React frontend
│   ├── components/
│   ├── context/
│   └── App.tsx
├── database/            # SQLite databases (created automatically)
├── uploads/             # Uploaded configuration files
├── DEVELOPMENT.md
└── buildrun.md
```

## Troubleshooting

### Port 4006 Already in Use
```bash
# Find process
netstat -ano | findstr :4006
# Kill process
taskkill /PID <PID> /F
```

### Database Issues
The application automatically:
1. Creates SQLite databases on first run
2. Creates default admin user (admin/admin)
3. Loads databases from Google Drive if available
4. Creates empty databases if not found

### Google Drive Access
1. Verify OAuth credentials in `.env`
2. Ensure redirect URI is exactly: `https://localhost:4006/callback`
3. Google Drive API must be enabled in Google Cloud Console

## Default Credentials
- **Username**: admin
- **Password**: admin
- **Role**: Administrator (can create users, manage tests)

## Hourly Backup
The system automatically backs up databases to Google Drive every hour.