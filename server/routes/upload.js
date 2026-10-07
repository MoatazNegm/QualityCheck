const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { saveUploadedFile } = require('../utils/fileStorage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

const uploadMiddleware = (req, res, next) => {
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'configFile', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Uploaded file exceeds the 100MB size limit.' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
};

/**
 * POST /api/upload
 * Generic file upload endpoint for testers, developers, and AI agents.
 * Supports:
 * 1. multipart/form-data with field name 'file' or 'configFile'
 * 2. application/json with { fileName, fileData (base64 string), mimeType }
 */
router.post('/', authenticateToken, uploadMiddleware, async (req, res) => {
  try {
    let fileBuffer = null;
    let originalName = 'upload.bin';
    let mimeType = 'application/octet-stream';
    let size = 0;

    // Case 1: multipart upload
    const uploadedFile = req.files && (req.files.file?.[0] || req.files.configFile?.[0]);
    if (uploadedFile) {
      fileBuffer = uploadedFile.buffer;
      originalName = uploadedFile.originalname;
      mimeType = uploadedFile.mimetype || 'application/octet-stream';
      size = uploadedFile.size;
    } else if (req.body && req.body.fileData) {
      // Case 2: base64 upload via JSON
      try {
        fileBuffer = Buffer.from(req.body.fileData, 'base64');
        originalName = req.body.fileName || 'upload.bin';
        mimeType = req.body.mimeType || 'application/octet-stream';
        size = fileBuffer.length;
      } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid base64 fileData provided' });
      }
    } else {
      return res.status(400).json({ error: 'No file provided. Use multipart/form-data or JSON with fileData (base64).' });
    }

    const userId = req.user.userId || 'anon';
    const ext = path.extname(originalName) || '.bin';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = `upload-u${userId}-${uniqueSuffix}${ext}`;

    const saved = await saveUploadedFile({
      fileBuffer,
      filename,
      originalName,
      mimeType,
      size
    });

    res.status(201).json({
      success: true,
      filePath: saved.filePath,
      filename: saved.filename,
      originalName: saved.originalName,
      fileSize: size,
      mimeType: mimeType
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: error.message || 'File upload failed' });
  }
});

module.exports = router;
