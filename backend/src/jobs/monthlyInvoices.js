const pool = require("../db/pool");
const { isBillingDue, firstOfMonth } = require("../lib/billing");
const { syncCollectionForInvoice } = require("../lib/collectionSync");
const { getCompany } = require("../lib/company");

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

async function nextInvoiceNumber(agencyId) {
  const result = await pool.query("SELECT number FROM invoices WHERE agency_id = $1", [agencyId]);
  let max = 0;
  result.rows.forEach((r) => {
    const n = parseInt((r.number || "").replace(/\D/g, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  const { invoice_prefix } = await getCompany(agencyId);
  return `${invoice_prefix || "INV"}-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Generates this month's invoices for every active client whose renewal
 * cycle says a bill is due this month (monthly clients every month,
 * quarterly every 3rd month from their anchor date, yearly every 12th).
 * Safe to run more than once in the same month — already-billed clients
 * for that month are skipped via the `for_month` column.
 */
async function generateForAgency(agencyId) {
  const today = new Date();
  const thisMonthFirst = firstOfMonth(today);
  const thisMonthISO = toISODate(thisMonthFirst);

  const clientsResult = await pool.query("SELECT * FROM clients WHERE contract_status = 'active' AND agency_id = $1", [agencyId]);
  const created = [];

  for (const c of clientsResult.rows) {
    if (!isBillingDue(c, thisMonthFirst)) continue;

    const dup = await pool.query(
      "SELECT id FROM invoices WHERE client_id = $1 AND for_month = $2 AND agency_id = $3",
      [c.id, thisMonthISO, agencyId]
    );
    if (dup.rows.length > 0) continue;

    // If the client has exactly one assigned service, tag the auto-invoice
    // with it so Service Analytics keeps working without manual editing.
    // With zero or multiple services assigned, leave it unassigned — no
    // safe way to guess which one a multi-service client is being billed for.
    const assignedServices = await pool.query(
      "SELECT cs.service_id FROM client_services cs JOIN services s ON s.id = cs.service_id WHERE cs.client_id = $1 AND s.agency_id = $2",
      [c.id, agencyId]
    );
    const serviceId = assignedServices.rows.length === 1 ? assignedServices.rows[0].service_id : null;

    const number = await nextInvoiceNumber(agencyId);
    const dueDate = new Date(thisMonthFirst);
    dueDate.setDate(dueDate.getDate() + 7);

    const monthLabelAr = `${MONTHS_AR[thisMonthFirst.getMonth()]} ${thisMonthFirst.getFullYear()}`;

    const inv = await pool.query(
      `INSERT INTO invoices
        (client_id, number, description, amount, currency, issue_date, due_date, status, is_auto_generated, for_month, service_id, agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'sent', true, $8, $9, $10)
       RETURNING *`,
      [
        c.id, number, `فاتورة تجديد تلقائي - ${monthLabelAr}`, c.contract_value,
        c.currency, thisMonthISO, toISODate(dueDate), thisMonthISO, serviceId, agencyId,
      ]
    );
    await syncCollectionForInvoice(inv.rows[0].id);
    created.push(inv.rows[0]);
  }

  return created;
}

// agencyId given  → that agency only (manual trigger from the app).
// agencyId absent → every active agency (the monthly cron job).
async function generateMonthlyInvoices(agencyId) {
  const agencies = agencyId
    ? [{ id: agencyId }]
    : (await pool.query("SELECT id FROM agencies WHERE is_active = true ORDER BY id")).rows;
  const created = [];
  for (const a of agencies) created.push(...(await generateForAgency(a.id)));
  return created;
}

module.exports = { generateMonthlyInvoices };
