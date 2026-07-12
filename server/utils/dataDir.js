// On Vercel (and other serverless platforms) the deployed code lives in a
// read-only filesystem (`/var/task/` on Vercel). The only writable location is
// `/tmp`, which is also ephemeral — it is wiped on every cold start / new
// deployment, so any data stored there is gone after a redeploy. Locally we
// just use the project root.
//
// `dataDir` is the single place every server-side file write should target.
// `isVercel` is exposed in case a caller wants different behaviour (e.g.
// disabling certain features) on Vercel.
const path = require('path');

const isVercel = !!process.env.VERCEL;

// `path.join(__dirname, '..', '..')` resolves to the project root locally.
// On Vercel we use /tmp because /var/task is read-only.
const dataDir = isVercel ? '/tmp' : path.join(__dirname, '..', '..');

module.exports = { dataDir, isVercel };
