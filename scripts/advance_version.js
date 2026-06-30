const fs = require('fs');
const path = require('path');

const constantsPath = path.join(__dirname, '../src/constants.ts');

try {
  let content = fs.readFileSync(constantsPath, 'utf8');
  
  // Match version format export const APP_VERSION = 'X.XXXXXXX';
  const versionRegex = /export const APP_VERSION = '([\d\.]+)';/;
  const match = content.match(versionRegex);
  
  if (!match) {
    throw new Error('APP_VERSION pattern not found in constants.ts');
  }
  
  const currentVersionStr = match[1];
  const currentVersion = parseFloat(currentVersionStr);
  
  if (isNaN(currentVersion)) {
    throw new Error(`Invalid version parsed: ${currentVersionStr}`);
  }
  
  // Increment by 0.0000001
  const newVersion = (currentVersion + 0.0000001).toFixed(7);
  
  content = content.replace(versionRegex, `export const APP_VERSION = '${newVersion}';`);
  
  fs.writeFileSync(constantsPath, content, 'utf8');
  console.log(`Version successfully advanced: ${currentVersionStr} -> ${newVersion}`);
} catch (error) {
  console.error('Failed to advance version:', error);
  process.exit(1);
}
