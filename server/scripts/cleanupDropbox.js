#!/usr/bin/env node
require('dotenv').config();
const { cleanupDropboxFiles, getDropboxSpaceUsage } = require('../dropbox/dropboxService');

async function main() {
  console.log('==================================================');
  console.log('       Dropbox Automated Storage Cleanup');
  console.log('==================================================');

  try {
    const spaceBefore = await getDropboxSpaceUsage();
    console.log(`[Before Cleanup]`);
    console.log(`  Allocated Quota : ${(spaceBefore.allocated / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Used Space      : ${(spaceBefore.used / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Free Space      : ${(spaceBefore.free / (1024 * 1024)).toFixed(2)} MB (${spaceBefore.freePercent.toFixed(2)}%)`);
    console.log('--------------------------------------------------');

    const result = await cleanupDropboxFiles({
      retentionDays: 30,
      minFreeSpaceRatio: 0.80
    });

    console.log(`[Cleanup Summary]`);
    console.log(`  Files Purged (>30d) : ${result.retentionDeletedCount}`);
    console.log(`  Files Purged (Quota): ${result.capacityDeletedCount}`);
    console.log(`  Total Files Deleted : ${result.deletedCount}`);
    console.log(`  Total Space Freed   : ${(result.freedBytes / (1024 * 1024)).toFixed(2)} MB (${result.freedBytes} bytes)`);
    console.log(`  Failed Operations   : ${result.failedCount}`);
    console.log('--------------------------------------------------');

    const spaceAfter = await getDropboxSpaceUsage();
    console.log(`[After Cleanup]`);
    console.log(`  Allocated Quota : ${(spaceAfter.allocated / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Used Space      : ${(spaceAfter.used / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Free Space      : ${(spaceAfter.free / (1024 * 1024)).toFixed(2)} MB (${spaceAfter.freePercent.toFixed(2)}%)`);
    console.log('==================================================');
    console.log('Cleanup finished successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err.message || err);
    process.exit(1);
  }
}

main();
