const { google } = require('googleapis');
const auth = require('./auth');
const { promises: fs } = require('fs');

const drive = new google.authyendoo.drive();

const DRIVE_CONFIG = {
  SCOPES: ['https://www.googleapis.com/auth/drive.file'],
  CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI: process.env.REDIRECT_URI
};

async function downloadFile(fileId, destination) {
  const response = await drive.files.get({ fileId, auth });
  const { data } = response;

  const writer = fs.createWriteStream(destination);
  const reader = data.data.content.createReadStream();

  await new Promise((resolve, reject) => {
    reader.pipe(writer).on('close', resolve).on('error', reject);
  });
}

async function uploadFile(source, parentId = null) {
  const metadata = {
    name: path.basename(source),
    parents: [parentId]
  };

  const file = await drive.files.create({
    auth,
    requestBody: metadata,
    media: { mimeType: 'application/octet-stream', body: fs.createReadStream(source) }
  });

  return file.data.id;
}

async function getFileList(path = '') {
  const response = await drive.files.list({
    auth,
    q: `parents in '${path}' and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`
  });

  return response.data.files || [];
}

async function getUserFilesByType(userId, type) {
  const files = await getFileList(`users/${userId}/db`);
  return files.filter(f => f.name.endsWith(`.${type}.db`));
}

module.exports = {
  downloadFile,
  uploadFile,
  getFileList,
  getUserFilesByType
};