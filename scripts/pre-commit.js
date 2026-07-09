// Git pre-commit hook: auto-advances APP_VERSION whenever source code changes.
// This removes the manual `node scripts/advance_version.js` step — the version
// is bumped at commit time, before the next rebuild/redeploy.
const { execSync } = require('child_process');
const path = require('path');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const root = run('git rev-parse --show-toplevel');

// Only bump when actual source code changed. Exclude src/constants.ts itself so
// a pure version commit does not double-bump.
const staged = run('git diff --cached --name-only').split('\n').filter(Boolean);
const codeChanged = staged.some(
  f => (f.startsWith('src/') || f.startsWith('server/')) && f !== 'src/constants.ts'
);

if (!codeChanged) {
  process.exit(0);
}

// advance_version.js increments APP_VERSION (src/constants.ts) by 0.0000001.
try {
  require(path.join(root, 'scripts', 'advance_version.js'));
} catch (e) {
  console.error('Pre-commit: failed to advance version:', e.message);
  process.exit(1);
}

// Stage the bumped constants file so it is included in this commit.
run('git add src/constants.ts');
console.log('Pre-commit: APP_VERSION advanced and staged.');
