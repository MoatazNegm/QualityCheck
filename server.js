const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4006;

// CORS Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://localhost:4006'],
  credentials: true
}));

// Body Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes
const authRoutes = require('./server/routes/auth');
const userRoutes = require('./server/routes/users');
const testRoutes = require('./server/routes/tests');
const testResultRoutes = require('./server/routes/test-results');
const reportRoutes = require('./server/routes/reports');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/test-results', testResultRoutes);
app.use('/api/reports', reportRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Serve React build in production
if (process.env.NODE_ENV === 'production' || fs.existsSync(path.join(__dirname, 'build'))) {
  app.use(express.static(path.join(__dirname, 'build')));
  app.get('*any', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;