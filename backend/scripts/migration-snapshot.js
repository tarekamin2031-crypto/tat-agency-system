// Before/after fingerprint of the database around the multi-agency migration.
//
//   BEFORE (old code, old schema):  node scripts/migration-snapshot.js save ./snapshot-before.json
//   AFTER  (new code, migrated):    node scripts/migration-snapshot.js compare ./snapshot-before.json
//
// "save" records row counts and key money totals. "compare" re-computes them and checks that
// nothing was lost or changed, then checks the new multi-agency invariants. Read-only: it never writes.
const fs = require("fs");
const pool = require("../src/db/pool");

const MONEY = [
  ["invoices_amount", "SELECT COALESCE(SUM(amount),0) AS v FROM invoices", "invoices"],
  ["invoices_paid", "SELECT COALESCE(SUM(paid_amount),0) AS v FROM invoices", "invoices"],
  ["expenses_business", "SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE expense_type = 'business'", "expenses"],
  ["expenses_personal", "SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE expense_type = 'personal'", "expenses"],
  ["ad_budgets_received", "SELECT COALESCE(SUM(amount_received),0) AS v FROM ad_budgets", "ad_budgets"],
  ["ad_budgets_commission", "SELECT COALESCE(SUM(commission_amount),0) AS v FROM ad_budgets", "ad_budgets"],
  ["collection_expected", "SELECT COALESCE(SUM(expected_amount),0) AS v FROM collection_entries", "collection_entries"],
  ["clients_contract_value", "SELECT COALESCE(SUM(contract_value),0) AS v FROM clients", "clients"],
];
// Tables that exist only after the migration — never compared against "before".
const NEW_TABLES = new Set(["agencies", "roles", "audit_logs", "email_settings", "email_log", "password_resets", "webhook_endpoints", "webhook_deliveries", "event_marks"]);

async function exists(t) { return (await pool.query("SELECT to_regclass($1) AS r", [`public.${t}`])).rows[0].r !== null; }

async function fingerprint() {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename);
  const counts = {};
  for (const t of tables) counts[t] = Number((await pool.query(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
  const money = {};
  for (const [key, sql, table] of MONEY) money[key] = (await exists(table)) ? Number((await pool.query(sql)).rows[0].v) : null;
  // older schemas have no is_active column — only select what exists
  const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")).rows.map((r) => r.column_name);
  const users = (await pool.query(`SELECT email, role${cols.includes("is_active") ? ", is_active" : ""} FROM users ORDER BY id`)).rows;
  return { taken_at: new Date().toISOString(), counts, money, users };
}

const [mode, file] = process.argv.slice(2);

(async () => {
  if (mode === "save" && file) {
    const fp = await fingerprint();
    fs.writeFileSync(file, JSON.stringify(fp, null, 2));
    console.log(`Saved snapshot (${Object.keys(fp.counts).length} tables, ${fp.users.length} users) → ${file}`);
    console.log("Row counts:", Object.entries(fp.counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(", "));
  } else if (mode === "compare" && file) {
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    const after = await fingerprint();
    let bad = 0;
    const check = (name, ok, detail = "") => { if (!ok) bad++; console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

    console.log("# nothing lost");
    for (const [t, n] of Object.entries(before.counts)) {
      if (NEW_TABLES.has(t)) continue;
      // services/company_settings are re-seeded per agency, users may gain none — compare "at least as many"
      check(`rows in ${t}`, (after.counts[t] ?? 0) >= n, `${n} → ${after.counts[t] ?? "missing"}`);
    }
    for (const [k, v] of Object.entries(before.money)) {
      if (v === null) continue;
      // The upgrade auto-links every unpaid invoice to a collection record, so this total may only GROW (by the unpaid amount).
      if (k === "collection_expected") { check(`total ${k} (may grow: unpaid invoices get linked)`, (after.money[k] ?? NaN) >= v - 0.005, `${v} → ${after.money[k]}`); continue; }
      check(`total ${k}`, Math.abs((after.money[k] ?? NaN) - v) < 0.005, `${v} → ${after.money[k]}`);
    }
    const emailsBefore = before.users.map((u) => u.email).sort().join("|");
    const emailsAfter = after.users.map((u) => u.email).filter((e) => before.users.some((b) => b.email === e)).sort().join("|");
    check("every existing user is still there", emailsBefore === emailsAfter);

    console.log("# multi-agency invariants");
    const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
    for (const t of ["clients", "invoices", "expenses", "collection_entries", "ad_budgets", "services", "company_settings"]) {
      const nulls = Number((await q(`SELECT COUNT(*) AS n FROM ${t} WHERE agency_id IS NULL`))[0].n);
      check(`${t}: no rows without an agency`, nulls === 0, nulls ? `${nulls} rows` : "");
    }
    const inOne = Number((await q("SELECT COUNT(*) AS n FROM clients WHERE agency_id = 1"))[0].n);
    check("agency #1 kept all of its clients", inOne >= (before.counts.clients || 0), `${before.counts.clients || 0} → ${inOne}`);
    const noRole = Number((await q("SELECT COUNT(*) AS n FROM users WHERE is_active AND role_id IS NULL AND NOT is_platform_admin"))[0].n);
    check("every active user has a role", noRole === 0, noRole ? `${noRole} users` : "");
    const admins = await q("SELECT email FROM users WHERE is_platform_admin");
    check("a platform owner exists", admins.length >= 1, admins.map((a) => a.email).join(", "));
    const lostAdmins = await q("SELECT u.email FROM users u JOIN roles r ON r.id = u.role_id WHERE u.role = 'admin' AND u.agency_id = 1 AND r.key <> 'agency_admin'");
    check("former admins kept admin rights", lostAdmins.length === 0, lostAdmins.map((a) => a.email).join(", "));
    const roles = Number((await q("SELECT COUNT(*) AS n FROM roles WHERE agency_id = 1"))[0].n);
    check("agency #1 has its default roles", roles >= 5, `${roles} roles`);

    console.log(bad ? `\n${bad} problem(s) — do NOT go live; restore the backup and tell me the output above.` : "\nAll good — data is intact.");
    process.exit(bad ? 1 : 0);
  } else {
    console.error("usage: node scripts/migration-snapshot.js save <file> | compare <file>");
    process.exit(2);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
