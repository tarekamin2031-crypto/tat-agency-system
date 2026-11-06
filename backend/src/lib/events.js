// Business events: fan out to the agency's webhooks and (optionally) to email.
// Every function is fire-and-forget and never throws into the request that caused it.
const pool = require("../db/pool");
const { emit } = require("./webhooks");
const { sendEmail } = require("./mailer");
const { getCompany } = require("./company");

const invoiceData = (i) => ({
  id: i.id, number: i.number, client_id: i.client_id, amount: Number(i.amount), paid_amount: Number(i.paid_amount),
  currency: i.currency, status: i.status, issue_date: i.issue_date, due_date: i.due_date,
});
const clientData = (c) => ({
  id: c.id, name: c.name, status: c.status, contract_value: c.contract_value == null ? null : Number(c.contract_value),
  renewal_cycle: c.renewal_cycle, contract_end: c.contract_end,
});

async function agencyAdmins(agencyId) {
  const { rows } = await pool.query(
    `SELECT u.email, u.name, u.preferences FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.agency_id = $1 AND u.is_active AND r.key = 'agency_admin'`, [agencyId]);
  return rows;
}

// Email the agency admins, only when the agency switched that notification on.
async function notifyAdmins(agencyId, flag, template, varsFor) {
  try {
    const s = (await pool.query(`SELECT ${flag} AS flag_on FROM email_settings WHERE agency_id = $1`, [agencyId])).rows[0];
    if (!s || !s.flag_on) return;
    const [admins, company, lang] = await Promise.all([
      agencyAdmins(agencyId), getCompany(agencyId),
      pool.query("SELECT default_language FROM agencies WHERE id = $1", [agencyId]).then((r) => (r.rows[0] && r.rows[0].default_language) || "ar"),
    ]);
    for (const a of admins) {
      await sendEmail({ agencyId, to: a.email, template, lang: (a.preferences && a.preferences.language) || lang, brand: company.name, vars: varsFor(a) });
    }
  } catch (err) {
    console.error("[events] notifyAdmins failed:", err.message);
  }
}

async function clientName(id, agencyId) {
  if (!id) return null;
  try { return ((await pool.query("SELECT name FROM clients WHERE id = $1 AND agency_id = $2", [id, agencyId])).rows[0] || {}).name || null; } catch { return null; }
}

const money = (n, c) => `${Number(n).toLocaleString("en-US")} ${c || ""}`.trim();

module.exports = {
  invoiceData, clientData, agencyAdmins, notifyAdmins,

  invoiceCreated: async (req, inv) => emit(req.user.agencyId, "invoice.created", { ...invoiceData(inv), client_name: await clientName(inv.client_id, req.user.agencyId) }),
  invoicePaid: async (req, inv) => {
    const name = await clientName(inv.client_id, req.user.agencyId);
    emit(req.user.agencyId, "invoice.paid", { ...invoiceData(inv), client_name: name });
    notifyAdmins(req.user.agencyId, "notify_payment", "payment", () => ({ number: inv.number, client: name || "—", amount: money(inv.amount, inv.currency) }));
  },
  paymentRecorded: async (req, inv, amount) => emit(req.user.agencyId, "payment.recorded", { ...invoiceData(inv), client_name: await clientName(inv.client_id, req.user.agencyId), payment_amount: Number(amount) }),
  clientCreated: (req, c) => emit(req.user.agencyId, "client.created", clientData(c)),
  clientUpdated: (req, c) => emit(req.user.agencyId, "client.updated", clientData(c)),
};
