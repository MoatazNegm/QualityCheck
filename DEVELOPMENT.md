# QualityCheck App Development Documentation

## Overview
QualityCheck is a quality assurance testing application that guides users through sequential test steps with mandatory compliance. Users must authenticate, complete tests in a specific order, and document failures with comments and configuration file uploads.

## Architecture Overview
```
qualitycheck/
├── server/                 # Backend server
│   ├── server.js           # Express server (runs on port 4006)
│   └── .env                # Environment variables
├── src/                    # React frontend
│   ├── components/         # UI components
│   └── App.tsx             # Main app component
├── database/               # SQLite databases (users.db, tests.db)
├── uploads/                # Uploaded configuration files
├── .env                    # Root environment file
├── DEVELOPMENT.md          # This file
└── buildrun.md             # Run instructions
```

## Database Structure

### Users Database (users.db)
- Stores user credentials and admin status
- Tables: users, user_sessions

### Tests Database (tests.db)
- Stores test definitions, steps, and results
- Tables: tests, test_steps, test_results

## Key Values and Locations

### Configuration
- **App Root**: C:\qualitycheck
- **Backend Port**: 4006
- **Frontend**: Served by backend on port 4006
- **Database Files**: C:\qualitycheck\*.db

### Environment Variables
Create `.env` file in C:\qualitycheck:
```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
REDIRECT_URI=https://localhost:4006/callback
JWT_SECRET=your-super-secret-jwt-key-change-in-production
PORT=4006
NODE_ENV=development
```

## Component Responsibilities

### Backend (server/server.js)
- REST API endpoints for authentication, tests, and results
- SQLite database management
- File upload handling
- JWT session management

### Frontend (src/)
- React components for UI
- Authentication context for state management
- API service layer

## Development Scripts
- `npm run server`: Start backend on port 4006
- `npm start`: Start React dev server (port 3000)
- `npm run build`: Build React app for production
- `npm test`: Run tests

## Security Notes
- Passwords are hashed using bcrypt
- Sessions are managed with JWT tokens
- File uploads are validated for type and size
- CORS configured for localhost only