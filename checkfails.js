require('dotenv').config();
const db = require('./server/db/db');
setTimeout(async () => {
  try {
    const failRows = await db.testsDb.prepare("SELECT DISTINCT ts.test_id FROM test_results tr JOIN test_steps ts ON tr.step_id = ts.id WHERE tr.user_id = 11 AND tr.round_id = 7 AND tr.result = 'fail' AND (ts.on_failure IS NULL OR ts.on_failure = 'stop')").all();
    console.log('Failed tests:', failRows);
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}, 2000);
