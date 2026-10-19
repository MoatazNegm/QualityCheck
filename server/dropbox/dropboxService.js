const { Dropbox } = require('dropbox');
const https = require('https');
const { testsDb } = require('../db/db');
const path = require('path');

async function getDropboxSettings() {
  let settings = {};
  try {
    const rows = await testsDb.prepare("SELECT key, value FROM settings WHERE key IN ('dropbox_enabled', 'dropbox_app_key', 'dropbox_app_secret', 'dropbox_refresh_token', 'dropbox_folder_path')").all();
    if (Array.isArray(rows)) {
      rows.forEach(r => settings[r.key] = r.value);
    }
  } catch (e) {
    console.error('Failed to get dropbox settings:', e);
  }
  return settings;
}

async function isDropboxConfigured() {
  const s = await getDropboxSettings();
  return s.dropbox_enabled === 'true' && Boolean(s.dropbox_app_key) && Boolean(s.dropbox_app_secret) && Boolean(s.dropbox_refresh_token);
}

async function getClient() {
  const s = await getDropboxSettings();
  if (!s.dropbox_app_key || !s.dropbox_app_secret || !s.dropbox_refresh_token) {
    throw new Error('Dropbox credentials (app_key, app_secret, refresh_token) are not configured.');
  }
  return new Dropbox({
    clientId: s.dropbox_app_key,
    clientSecret: s.dropbox_app_secret,
    refreshToken: s.dropbox_refresh_token
  });
}

async function testDropboxConnection(appKey, appSecret, refreshToken) {
  const dbx = new Dropbox({ clientId: appKey, clientSecret: appSecret, refreshToken });
  const check = await dbx.usersGetCurrentAccount();
  return check.result;
}

async function uploadFileToDropbox(fileBuffer, originalFilename, mimeType) {
  const s = await getDropboxSettings();
  const folder = (s.dropbox_folder_path || '').trim().replace(/\/$/, '');
  const targetPath = folder === '' ? `/${originalFilename}` : `${folder}/${originalFilename}`;
  
  const dbx = await getClient();
  const response = await dbx.filesUpload({
    path: targetPath,
    contents: fileBuffer,
    mode: { '.tag': 'overwrite' }
  });
  
  return response.result.id;
}

async function downloadFileStreamFromDropbox(fileId) {
  const dbx = await getClient();
  await dbx.auth.refreshAccessToken();
  const accessToken = dbx.auth.getAccessToken();

  return new Promise((resolve, reject) => {
    const req = https.request('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: fileId })
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Dropbox download failed: ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.end();
  });
}

async function deleteFileFromDropbox(fileId) {
  try {
    const dbx = await getClient();
    await dbx.filesDeleteV2({ path: fileId });
  } catch (error) {
    console.error('Failed to delete from Dropbox:', error);
  }
}

async function exchangeCodeForRefreshToken(appKey, appSecret, code, redirectUri) {
  const dbx = new Dropbox({ clientId: appKey, clientSecret: appSecret });
  dbx.auth.setClientId(appKey);
  dbx.auth.setClientSecret(appSecret);
  const response = await dbx.auth.getAccessTokenFromCode(redirectUri, code);
  return response.result.refresh_token;
}

async function getDropboxSpaceUsage() {
  const dbx = await getClient();
  const space = await dbx.usersGetSpaceUsage();
  const allocated = space.result.allocation ? (space.result.allocation.allocated || 0) : 0;
  const used = space.result.used || 0;
  const free = Math.max(0, allocated - used);
  const freePercent = allocated > 0 ? (free / allocated) * 100 : 0;
  return {
    allocated,
    used,
    free,
    freePercent,
    raw: space.result
  };
}

async function cleanupDropboxFiles({ retentionDays = 30, minFreeSpaceRatio = 0.80 } = {}) {
  const s = await getDropboxSettings();
  if (s.dropbox_enabled !== 'true') {
    throw new Error('Dropbox is not enabled in settings.');
  }
  const dbx = await getClient();

  // 1. Initial space
  const initialSpace = await dbx.usersGetSpaceUsage();
  const allocated = initialSpace.result.allocation ? (initialSpace.result.allocation.allocated || 0) : 0;
  let currentUsed = initialSpace.result.used || 0;
  let currentFree = allocated - currentUsed;
  let currentFreeRatio = allocated > 0 ? currentFree / allocated : 1;

  // 2. Fetch all files from Dropbox folder
  const folder = (s.dropbox_folder_path || '').trim();
  const folderPath = folder === '/' ? '' : folder;

  let files = [];
  let res = await dbx.filesListFolder({ path: folderPath, recursive: false });
  files = files.concat(res.result.entries);
  while (res.result.has_more) {
    res = await dbx.filesListFolderContinue({ cursor: res.result.cursor });
    files = files.concat(res.result.entries);
  }

  const fileEntries = files.filter(f => f['.tag'] === 'file');
  fileEntries.sort((a, b) => new Date(a.server_modified || a.client_modified) - new Date(b.server_modified || b.client_modified));

  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const monthOldFiles = fileEntries.filter(f => new Date(f.server_modified || f.client_modified) < cutoff);
  const remainingFiles = fileEntries.filter(f => new Date(f.server_modified || f.client_modified) >= cutoff);

  let deletedFiles = [];
  let failedDeletions = [];
  let freedBytes = 0;

  async function deleteOne(file, reason) {
    try {
      await dbx.filesDeleteV2({ path: file.path_lower || file.id });
      freedBytes += file.size;
      deletedFiles.push({
        name: file.name,
        path: file.path_display,
        size: file.size,
        modified: file.server_modified,
        reason
      });

      // Update Database
      await testsDb.prepare('DELETE FROM uploaded_files WHERE filename = ? OR dropbox_file_id = ?').run(file.name, file.id);
      const configPath = `/uploads/${file.name}`;
      await testsDb.prepare('UPDATE test_results SET config_file_path = NULL WHERE config_file_path = ?').run(configPath);
      await testsDb.prepare('UPDATE test_submissions SET config_file_path = NULL WHERE config_file_path = ?').run(configPath);
      return true;
    } catch (err) {
      console.error(`[Dropbox Cleanup] Failed to delete ${file.name}:`, err.message);
      failedDeletions.push({ name: file.name, error: err.message, reason });
      return false;
    }
  }

  // Step 1: Delete files older than retentionDays
  for (const file of monthOldFiles) {
    const ok = await deleteOne(file, 'older_than_retention_period');
    if (ok) {
      currentUsed -= file.size;
    }
  }

  currentFree = allocated - currentUsed;
  currentFreeRatio = allocated > 0 ? currentFree / allocated : 1;

  // Step 2: Delete oldest files until free space is at least minFreeSpaceRatio (e.g. 80%)
  let capacityDeletedCount = 0;
  if (currentFreeRatio < minFreeSpaceRatio) {
    for (const file of remainingFiles) {
      if (currentFreeRatio >= minFreeSpaceRatio) break;
      const ok = await deleteOne(file, 'capacity_target_free_space');
      if (ok) {
        capacityDeletedCount++;
        currentUsed -= file.size;
        currentFree = allocated - currentUsed;
        currentFreeRatio = allocated > 0 ? currentFree / allocated : 1;
      }
    }
  }

  // Refresh live final space usage
  const finalSpace = await dbx.usersGetSpaceUsage();

  return {
    allocatedBytes: allocated,
    initialUsedBytes: initialSpace.result.used,
    finalUsedBytes: finalSpace.result.used,
    freedBytes,
    deletedCount: deletedFiles.length,
    retentionDeletedCount: deletedFiles.filter(d => d.reason === 'older_than_retention_period').length,
    capacityDeletedCount,
    failedCount: failedDeletions.length,
    finalFreePercent: allocated > 0 ? ((allocated - finalSpace.result.used) / allocated) * 100 : 100,
    deletedFiles
  };
}

module.exports = {
  getClient,
  isDropboxConfigured,
  testDropboxConnection,
  uploadFileToDropbox,
  downloadFileStreamFromDropbox,
  deleteFileFromDropbox,
  exchangeCodeForRefreshToken,
  getDropboxSettings,
  getDropboxSpaceUsage,
  cleanupDropboxFiles
};
