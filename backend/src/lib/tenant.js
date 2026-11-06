const defaultPool = require("../db/pool");

const TABLES = new Set(["clients", "services", "invoices", "expenses", "collection_entries", "ad_budgets", "users"]);

// True when `id` is empty (nothing to check) or a row of `table` that belongs to the agency.
// Used wherever a request references another record (client_id, service_id, invoice_id…)
// so one agency can never attach its data to another agency's rows.
async function ownsRow(table, id, agencyId, db = defaultPool) {
  if (id === null || id === undefined || id === "") return true;
  if (!TABLES.has(table)) throw new Error(`ownsRow: unknown table ${table}`);
  const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND agency_id = $2`, [id, agencyId]);
  return rows.length > 0;
}

async function ownsAll(refs, agencyId, db = defaultPool) {
  for (const [table, id] of refs) {
    if (!(await ownsRow(table, id, agencyId, db))) return false;
  }
  return true;
}

module.exports = { ownsRow, ownsAll };
