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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const { dataDir } = require('./server/utils/dataDir');
const { testsDb } = require('./server/db/db');

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

// Uploaded file download handler with Google Drive streaming, local cache, and DB fallback
app.get('/uploads/:filename', async (req, res) => {
  try {
    const rawFilename = req.params.filename;
    const filename = path.basename(rawFilename);
    if (!filename || filename === '.' || filename === '..') {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const uploadDir = path.join(dataDir, 'uploads');
    const absPath = path.join(uploadDir, filename);

    // 1. Check if file exists on disk cache
    if (fs.existsSync(absPath)) {
      let originalName = filename;
      let mimeType = null;
      try {
        const row = await testsDb.prepare('SELECT original_name, mime_type FROM uploaded_files WHERE filename = ?').get(filename);
        if (row) {
          if (row.original_name) originalName = row.original_name;
          if (row.mime_type) mimeType = row.mime_type;
        }
      } catch (e) {
        // Fall back to filename on disk
      }

      if (!mimeType) {
        mimeType = getMimeType(originalName || filename);
      }

      const safeAsciiName = originalName.replace(/["\r\n\\]/g, '_');
      const fileBuffer = fs.readFileSync(absPath);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`);
      res.setHeader('Content-Length', fileBuffer.length);
      return res.send(fileBuffer);
    }

    // 2. Query uploaded_files table from database
    let dbRow = null;
    try {
      dbRow = await testsDb.prepare('SELECT original_name, mime_type, dropbox_file_id, file_data FROM uploaded_files WHERE filename = ?').get(filename);
    } catch (dbErr) {
      console.error('Error fetching upload from DB:', dbErr);
    }

    const originalName = (dbRow && dbRow.original_name) ? dbRow.original_name : filename;
    const safeAsciiName = originalName.replace(/["\r\n\\]/g, '_');
    const mimeType = (dbRow && dbRow.mime_type) ? dbRow.mime_type : getMimeType(originalName || filename);

    const dropboxService = require('./server/dropbox/dropboxService');

    // Case A: File is stored on Dropbox (dropbox_file_id)
    if (dbRow && dbRow.dropbox_file_id) {
      try {
        const dropboxStream = await dropboxService.downloadFileStreamFromDropbox(dbRow.dropbox_file_id);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`);
        
        // Cache to local disk asynchronously for fast subsequent reads
        try {
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const writeCache = fs.createWriteStream(absPath);
          dropboxStream.pipe(writeCache);
        } catch (_) { /* ignore cache write error */ }

        return dropboxStream.pipe(res);
      } catch (dropboxErr) {
        console.error('[Dropbox] Failed to stream file from Dropbox:', dropboxErr);
      }
    }

    // Case B: Legacy Base64 stored in database
    if (dbRow && dbRow.file_data) {
      const fileBuffer = Buffer.from(dbRow.file_data, 'base64');
      try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(absPath, fileBuffer);
      } catch (_) { /* ignore cache write error */ }

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`);
      res.setHeader('Content-Length', fileBuffer.length);
      return res.send(fileBuffer);
    }

    // 3. Not found anywhere: return 404 (NEVER fall through to SPA index.html)
    return res.status(404).json({ error: 'Attachment file not found' });
  } catch (error) {
    console.error('Download upload error:', error);
    return res.status(500).json({ error: 'Failed to retrieve attachment file' });
  }
});

// Guard: ensure ANY unmatched /uploads route returns 404 and NEVER falls through to SPA index.html
app.use('/uploads', (req, res) => {
  res.status(404).json({ error: 'Attachment not found' });
});

// Import routes
const authRoutes = require('./server/routes/auth');
const userRoutes = require('./server/routes/users');
const testRoutes = require('./server/routes/tests');
const testResultRoutes = require('./server/routes/test-results');
const reportRoutes = require('./server/routes/reports');
const backupRoutes = require('./server/routes/backup');
const versionRoutes = require('./server/routes/versions');
const settingsRoutes = require('./server/routes/settings');

app.use('/api/auth', authRoutes.router || authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/test-results', testResultRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/versions', versionRoutes);
app.use('/api/settings', settingsRoutes);

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