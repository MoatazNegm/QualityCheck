const { testsDb, initDB } = require('./server/db/db');

function seed() {
  // Clear existing data (optional, but good for clean seed)
  testsDb.prepare('DELETE FROM test_results').run();
  testsDb.prepare('DELETE FROM test_steps').run();
  testsDb.prepare('DELETE FROM tests').run();

  // Insert Test 1
  const test1Result = testsDb.prepare(`
    INSERT INTO tests (name, description)
    VALUES (?, ?)
  `).run('Network Connectivity & Performance', 'Verifies basic networking, latency, DNS resolution, and speed standards.');
  
  const test1Id = test1Result.lastInsertRowid;

  // Insert Test 1 Steps
  testsDb.prepare(`
    INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, on_failure)
    VALUES (?, 1, 'Ping the local gateway to ensure network link layer is functional.', 'Gateway ping response is received in < 5ms.', 10.0, 'stop')
  `).run(test1Id);

  testsDb.prepare(`
    INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, on_failure)
    VALUES (?, 2, 'Resolve an external hostname (e.g., google.com) via local DNS resolver.', 'DNS resolver successfully returns one or more IP addresses.', 15.0, 'stop')
  `).run(test1Id);

  testsDb.prepare(`
    INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, on_failure)
      VALUES (?, 3, 'Perform a bandwidth speed test to ensure downstream rates match requirements.', 'Download speed matches or exceeds 50 Mbps.', 25.0, 'stop')
  `).run(test1Id);

  // Insert Test 2
  const test2Result = testsDb.prepare(`
    INSERT INTO tests (name, description)
    VALUES (?, ?)
  `).run('Security Compliance Check', 'Audits firewall configuration, open ports, and operating system patch updates.');
  
  const test2Id = test2Result.lastInsertRowid;

  // Insert Test 2 Steps
  testsDb.prepare(`
    INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, on_failure)
    VALUES (?, 1, 'Check active local firewall service state.', 'Local firewall is active and blocking incoming connections by default.', 20.0, 'stop')
  `).run(test2Id);

  testsDb.prepare(`
    INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, on_failure)
      VALUES (?, 2, 'Scan for listening ports on the local host.', 'No unexpected listening ports found (only HTTP 80/443 and API 4006 allowed).', 30.0, 'stop')
  `).run(test2Id);

  testsDb.prepare(`
    INSERT INTO test_steps (test_id, step_number, description, success_symptom, value, on_failure)
      VALUES (?, 3, 'Query update manager for any unapplied critical security updates.', 'Zero critical security patches pending installation.', 15.0, 'stop')
  `).run(test2Id);

  console.log('Database seeded with sample tests and steps successfully!');
}

seed();
