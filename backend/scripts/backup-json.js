// Logical safety-net backup: dumps every table to one JSON file (BYTEA columns as base64).
// For real deployments prefer pg_dump (see docs/ROADMAP-SAAS.md); this script needs no extra tools.
//   node scripts/backup-json.js ./backup.json
const fs = require("fs");
const pool = require("../src/db/pool");

(async () => {
  const out = process.argv[2] || `backup-${new Date().toISOString().slice(0, 10)}.json`;
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename);
  const dump = {};
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT * FROM "${t}"`);
    dump[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString("base64") : v])));
  }
  fs.writeFileSync(out, JSON.stringify(dump));
  console.log(`Backed up ${tables.length} tables → ${out}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
