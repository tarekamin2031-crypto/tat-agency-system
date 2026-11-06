// Logical safety-net backup: dumps every table to one JSON file (BYTEA columns as base64).
// For real deployments prefer pg_dump (see docs/ROADMAP-SAAS.md); this script needs no extra tools.
//   node scripts/backup-json.js ./backup.json
const fs = require("fs");
const path = require("path");

// Convenience: when run without DB env vars, use the Neon URL from ../.env.local (direct/unpooled connection).
const envFile = path.join(__dirname, "..", "..", ".env.local");
if (!process.env.DATABASE_URL && !process.env.DB_HOST && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
  process.env.DB_SSL = process.env.DB_SSL || "true";
}
const pool = require("../src/db/pool");

(async () => {
  const dir = path.join(__dirname, "..", "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const out = process.argv[2] || path.join(dir, `neon-${new Date().toISOString().slice(0, 10)}.json`);
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename);
  const dump = {};
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT * FROM "${t}"`);
    dump[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString("base64") : v])));
  }
  fs.writeFileSync(out, JSON.stringify(dump));
  const counts = Object.entries(dump).filter(([, r]) => r.length).map(([t, r]) => `${t}=${r.length}`).join(" ");
  console.log(`Backed up ${tables.length} tables → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  console.log(`Rows: ${counts}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
