const pool = require("../db/pool");
const { emit } = require("../lib/webhooks");
const { invoiceData, clientData, notifyAdmins } = require("../lib/events");

const RENEWAL_DAYS = 7;
const FRESH_OVERDUE_DAYS = 3; // older ones are marked silently so a first run doesn't flood webhooks

// Inserts a marker; true only the first time (so each entity announces once).
async function mark(agencyId, key) {
  const r = await pool.query("INSERT INTO event_marks (agency_id, key) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING key", [agencyId, key]);
  return r.rowCount > 0;
}

async function runForAgency(agencyId) {
  const result = { overdue: 0, renewals: 0 };

  // ---- invoices that became overdue ----
  const inv = await pool.query(
    `SELECT i.*, c.name AS client_name, (CURRENT_DATE - i.due_date) AS days_late
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.agency_id = $1 AND i.due_date < CURRENT_DATE AND i.amount > i.paid_amount`, [agencyId]);
  const fresh = [];
  for (const i of inv.rows) {
    if (!(await mark(agencyId, `invoice.overdue:${i.id}`))) continue;
    if (Number(i.days_late) > FRESH_OVERDUE_DAYS) continue;
    await emit(agencyId, "invoice.overdue", { ...invoiceData(i), client_name: i.client_name, days_overdue: Number(i.days_late) });
    fresh.push(`${i.number} — ${i.client_name || "—"} — ${Number(i.amount) - Number(i.paid_amount)} ${i.currency}`);
    result.overdue++;
  }
  if (fresh.length) await notifyAdmins(agencyId, "notify_overdue", "overdue", () => ({ items: fresh }));

  // ---- contracts ending within the next week ----
  const cl = await pool.query(
    `SELECT *, (contract_end - CURRENT_DATE) AS days_left FROM clients
      WHERE agency_id = $1 AND status = 'Active' AND contract_end IS NOT NULL
        AND contract_end >= CURRENT_DATE AND contract_end <= CURRENT_DATE + $2::int`, [agencyId, RENEWAL_DAYS]);
  for (const c of cl.rows) {
    const end = new Date(c.contract_end).toISOString().slice(0, 10);
    if (!(await mark(agencyId, `renewal:${c.id}:${end}`))) continue;
    await emit(agencyId, "renewal.upcoming", { ...clientData(c), days_left: Number(c.days_left) });
    result.renewals++;
  }
  return result;
}

async function runDailyEvents() {
  const { rows } = await pool.query("SELECT id FROM agencies WHERE is_active ORDER BY id");
  const out = {};
  for (const a of rows) {
    try { out[a.id] = await runForAgency(a.id); } catch (err) { console.error(`[daily-events] agency ${a.id} failed:`, err.message); }
  }
  return out;
}

module.exports = { runDailyEvents, runForAgency };
