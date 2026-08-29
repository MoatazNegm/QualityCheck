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

module.exports = {
  isDropboxConfigured,
  testDropboxConnection,
  uploadFileToDropbox,
  downloadFileStreamFromDropbox,
  deleteFileFromDropbox,
  exchangeCodeForRefreshToken,
  getDropboxSettings
};
