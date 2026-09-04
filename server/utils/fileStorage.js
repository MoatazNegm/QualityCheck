const fs = require('fs');
const path = require('path');
const { dataDir } = require('./dataDir');
const { testsDb } = require('../db/db');
const dropboxService = require('../dropbox/dropboxService');

const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Persists an uploaded file using the app's unified storage pipeline:
 * 1. Checks if Dropbox is configured. If so, uploads to Dropbox and records dropbox_file_id.
 * 2. If not stored in Dropbox, retains Base64 representation in uploaded_files table for persistence.
 * 3. Writes/preserves local cache on disk at uploadDir.
 * 4. Records file metadata in the uploaded_files database table.
 */
async function saveUploadedFile({ fileBuffer, filename, originalName, mimeType, size }) {
  const nowIso = new Date().toISOString();
  let dropboxFileId = null;

  try {
    const isDropboxActive = await dropboxService.isDropboxConfigured();
    if (isDropboxActive) {
      try {
        dropboxFileId = await dropboxService.uploadFileToDropbox(
          fileBuffer,
          filename,
          mimeType || 'application/octet-stream'
        );
        console.log(`[Storage] Uploaded ${filename} to Dropbox (ID: ${dropboxFileId})`);
      } catch (dropboxErr) {
        console.error('[Storage] Dropbox upload failed, falling back to local/DB storage:', dropboxErr);
      }
    }
  } catch (err) {
    console.error('[Storage] Dropbox check error:', err);
  }

  const origName = originalName || filename;
  const mime = mimeType || 'application/octet-stream';
  let base64Data = null;
  if (!dropboxFileId) {
    base64Data = fileBuffer.toString('base64');
  }

  await testsDb.prepare(`
    INSERT OR REPLACE INTO uploaded_files (filename, original_name, mime_type, file_size, dropbox_file_id, file_data, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(filename, origName, mime, size, dropboxFileId, base64Data, nowIso);

  const absPath = path.join(uploadDir, filename);
  if (dropboxFileId && fs.existsSync(absPath)) {
    try {
      fs.unlinkSync(absPath);
    } catch (unlinkErr) {
      console.warn('[Storage] Failed to clean up temp local file:', unlinkErr.message);
    }
  } else if (!dropboxFileId && !fs.existsSync(absPath)) {
    try {
      fs.writeFileSync(absPath, fileBuffer);
    } catch (writeErr) {
      console.warn('[Storage] Failed to write local cache file:', writeErr.message);
    }
  }

  return {
    filePath: `/uploads/${filename}`,
    filename,
    originalName: origName,
    dropboxFileId
  };
}

module.exports = {
  uploadDir,
  saveUploadedFile
};
