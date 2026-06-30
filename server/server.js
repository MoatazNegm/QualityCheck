const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4006;

// CORS Middleware
app.use(cors());
app.use(cors({
  origin: 'http://localhost:3000', // React dev server
  credentials: true
}));

// Body Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const testRoutes = require('./routes/tests');
const testResultRoutes = require('./routes/test-results');
const reportRoutes = require('./routes/reports');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/test-results', testResultRoutes);
app.use('/api/reports', reportRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

if (process.env.NODE_ENV === 'production' || fs.existsSync(path.join(__dirname, '../build'))) {
  app.use(express.static(path.join(__dirname, '../build')));
  app.get('*any', (req, res) => {
    res.sendFile(path.join(__dirname, '../build', 'index.html'));
  });
}

const PORT_API = process.env.PORT_API || 4006;
app.listen(PORT_API, () => {
  console.log(`Server running on port ${PORT_API}`);
});

module.exports = app;