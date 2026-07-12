const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { dataDir } = require('./utils/dataDir');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4006;

// CORS Middleware
app.use(cors({ origin: true, credentials: true }));

// Body Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files. On Vercel uploads are written to /tmp (see utils/dataDir),
// so the static route must read from the same place or freshly uploaded files
// would 404.
app.use('/uploads', express.static(path.join(dataDir, 'uploads')));

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const testRoutes = require('./routes/tests');
const testResultRoutes = require('./routes/test-results');
const reportRoutes = require('./routes/reports');
const backupRoutes = require('./routes/backup');
const versionRoutes = require('./routes/versions');

(async () => {
  try {
    await authRoutes.ensureAdminUser();
  } catch (err) {
    console.error('Failed to ensure admin user:', err);
  }
})();

app.use('/api/auth', authRoutes.router);
app.use('/api/users', userRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/test-results', testResultRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/versions', versionRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

if (process.env.NODE_ENV === 'production' || fs.existsSync(path.join(__dirname, '../build'))) {
  const buildDir = path.join(__dirname, '../build');
  // Serve static files (JS, CSS, images). If a file isn't found, fall through to the
  // SPA catch-all below. This order works correctly on both local dev and Vercel
  // serverless where the vercel.json static build would otherwise intercept SPA routes.
  app.use(express.static(buildDir));
  // SPA catch-all: serves index.html for any route not matched by an API or static file.
  // This must come after express.static so actual files are served first.
  app.use((req, res) => {
    try {
      const content = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(content);
    } catch (error) {
      console.error('Failed to serve index.html:', error);
      res.status(500).send('Server error');
    }
  });
}

const PORT_API = process.env.PORT_API || process.env.PORT || 4006;

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT_API, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT_API}`);
  });
}