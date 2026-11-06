const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireAnyPermission, can } = require("../middleware/auth");
const { resolveDateRange } = require("../utils/dateRange");
const { computeHealthScore, computeProfitSummary } = require("../lib/calculations");

const router = express.Router();
router.use(requireAuth);
// Every finance view is readable with dashboard.view or reports.view.
router.use(requireAnyPermission([["dashboard", "view"], ["reports", "view"]]));

// Agency commission on client ad budgets (ad_budgets.commission_amount) counts
// as company income. Ad budgets belong to a client, not a service, so callers
// skip this when a specific service filter is active.
// opts: { currency, client_id, client_status, from, to, groupBy: "month"|"client"|"platform"|null }
async function queryAdCommission({ agencyId, currency, client_id, client_status, from, to, groupBy = null }) {
  const params = [currency, agencyId];
  const cond = [`ab.currency = $1`, `ab.agency_id = $2`];
  if (client_id && client_id !== "all") { params.push(client_id); cond.push(`ab.client_id = $${params.length}`); }
  if (client_status && client_status !== "all") { params.push(client_status); cond.push(`c.status = $${params.length}`); }
  if (from) { params.push(from); cond.push(`ab.received_date >= $${params.length}`); }
  if (to) { params.push(to); cond.push(`ab.received_date <= $${params.length}`); }
  const select = groupBy === "month" ? `to_char(ab.received_date,'YYYY-MM') AS k,`
    : groupBy === "client" ? `ab.client_id AS k,`
    : groupBy === "platform" ? `ab.platform AS k,` : "";
  const group = groupBy ? "GROUP BY k" : "";
  const result = await pool.query(
    `SELECT ${select} COALESCE(SUM(ab.commission_amount),0) AS commission
     FROM ad_budgets ab LEFT JOIN clients c ON c.id = ab.client_id
     WHERE ${cond.join(" AND ")} ${group}`,
    params
  );
  return groupBy ? result.rows : Number(result.rows[0].commission);
}

// GET /api/finance/summary
// Optional query params (Global Filter System): client_id, service_id,
// client_status, date_range (+ from/to for "custom"), currency (default EGP)
router.get("/summary", async (req, res) => {
  const { client_id, service_id, client_status, date_range, from: customFrom, to: customTo } = req.query;
  const currency = req.query.currency || "EGP";

  try {
    // ---- Invoices side: Revenue, Cash Collected, Outstanding ----
    const invConditions = [`i.currency = $1`, `i.agency_id = $2`];
    const invParams = [currency, req.user.agencyId];

    if (client_id && client_id !== "all") {
      invParams.push(client_id);
      invConditions.push(`i.client_id = $${invParams.length}`);
    }
    if (service_id && service_id !== "all") {
      invParams.push(service_id);
      invConditions.push(`i.service_id = $${invParams.length}`);
    }
    if (client_status && client_status !== "all") {
      invParams.push(client_status);
      invConditions.push(`c.status = $${invParams.length}`);
    }
    if (date_range && date_range !== "all") {
      const { from, to } = resolveDateRange(date_range, customFrom, customTo);
      if (from) { invParams.push(from); invConditions.push(`i.issue_date >= $${invParams.length}`); }
      if (to) { invParams.push(to); invConditions.push(`i.issue_date <= $${invParams.length}`); }
    }

    const invWhere = `WHERE ${invConditions.join(" AND ")}`;
    const invResult = await pool.query(
      `SELECT
          COALESCE(SUM(i.amount),0) AS revenue,
          COALESCE(SUM(i.paid_amount),0) AS cash_collected,
          COALESCE(SUM(i.amount - i.paid_amount),0) AS outstanding_balance
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       ${invWhere}`,
      invParams
    );

    // ---- Expenses side (business only — personal/CEO draws tracked separately) ----
    const expConditions = [`e.currency = $1`, `e.agency_id = $2`, `e.expense_type = 'business'`];
    const expParams = [currency, req.user.agencyId];

    if (client_id && client_id !== "all") {
      expParams.push(client_id);
      expConditions.push(`e.related_client_id = $${expParams.length}`);
    }
    if (service_id && service_id !== "all") {
      expParams.push(service_id);
      expConditions.push(`e.related_service_id = $${expParams.length}`);
    }
    if (date_range && date_range !== "all") {
      const { from, to } = resolveDateRange(date_range, customFrom, customTo);
      if (from) { expParams.push(from); expConditions.push(`e.date >= $${expParams.length}`); }
      if (to) { expParams.push(to); expConditions.push(`e.date <= $${expParams.length}`); }
    }

    const expWhere = `WHERE ${expConditions.join(" AND ")}`;
    const expResult = await pool.query(
      `SELECT COALESCE(SUM(e.amount),0) AS total_expenses FROM expenses e ${expWhere}`,
      expParams
    );

    // ---- Personal (CEO) expenses — same filters, different expense_type ----
    const personalWhere = expWhere.replace("expense_type = 'business'", "expense_type = 'personal'");
    // CEO personal spending is only counted for roles that may see it.
    const personalResult = can(req.user, "personal_expenses", "view")
      ? await pool.query(`SELECT COALESCE(SUM(e.amount),0) AS total_personal FROM expenses e ${personalWhere}`, expParams)
      : { rows: [{ total_personal: 0 }] };

    let adFrom = null, adTo = null;
    if (date_range && date_range !== "all") ({ from: adFrom, to: adTo } = resolveDateRange(date_range, customFrom, customTo));
    const serviceFiltered = service_id && service_id !== "all";
    const adCommission = serviceFiltered ? 0 : await queryAdCommission({ agencyId: req.user.agencyId, currency, client_id, client_status, from: adFrom, to: adTo });

    const revenue = Number(invResult.rows[0].revenue);
    const cashCollected = Number(invResult.rows[0].cash_collected);
    const outstandingBalance = Number(invResult.rows[0].outstanding_balance);
    const totalExpenses = Number(expResult.rows[0].total_expenses);
    const personalExpenses = Number(personalResult.rows[0].total_personal);

    res.json({
      currency,
      ...computeProfitSummary({ revenue, cashCollected, outstandingBalance, totalExpenses, personalExpenses, adCommission }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating finance summary" });
  }
});

// GET /api/finance/payment-center
// Optional query params (Global Filter System): client_id, service_id,
// client_status, date_range (+ from/to for "custom", applied to due_date)
router.get("/payment-center", async (req, res) => {
  const { client_id, service_id, client_status, date_range, from: customFrom, to: customTo } = req.query;

  const conditions = ["i.agency_id = $1"];
  const params = [req.user.agencyId];

  if (client_id && client_id !== "all") {
    params.push(client_id);
    conditions.push(`i.client_id = $${params.length}`);
  }
  if (service_id && service_id !== "all") {
    params.push(service_id);
    conditions.push(`i.service_id = $${params.length}`);
  }
  if (client_status && client_status !== "all") {
    params.push(client_status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (date_range && date_range !== "all") {
    const { from, to } = resolveDateRange(date_range, customFrom, customTo);
    // Issue date — the same field /summary and the invoices list filter on,
    // so these totals always tie out with the rest of the system.
    if (from) { params.push(from); conditions.push(`i.issue_date >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`i.issue_date <= $${params.length}`); }
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const result = await pool.query(
      `SELECT i.id, i.number, i.amount, i.paid_amount, i.currency, i.due_date, i.issue_date,
              c.name AS client_name, c.id AS client_id, c.status AS client_status
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       ${where}
       ORDER BY i.due_date ASC NULLS LAST`,
      params
    );

    const today = new Date().toISOString().slice(0, 10);
    const rows = result.rows.map((r) => {
      const amount = Number(r.amount);
      const paid = Number(r.paid_amount);
      const remaining = amount - paid;
      const dueDateStr = r.due_date ? r.due_date.toISOString().slice(0, 10) : null;

      let status;
      if (paid >= amount && amount > 0) status = "Paid";
      else if (paid > 0) status = "PartiallyPaid";
      else if (dueDateStr && dueDateStr < today) status = "Overdue";
      else status = "NotPaid";

      let daysOverdue = 0;
      if (dueDateStr && dueDateStr < today && status !== "Paid") {
        daysOverdue = Math.round((new Date(today) - new Date(dueDateStr)) / 86400000);
      }

      return {
        invoice_id: r.id,
        number: r.number,
        client_id: r.client_id,
        client_name: r.client_name,
        client_status: r.client_status,
        contract_reference: r.number,
        required_amount: amount,
        paid_amount: paid,
        remaining_amount: remaining,
        currency: r.currency,
        due_date: dueDateStr,
        payment_status: status,
        days_overdue: daysOverdue,
      };
    });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating payment center data" });
  }
});

// GET /api/finance/aging-report
// Optional query params (Global Filter System): client_id, service_id, client_status
router.get("/aging-report", async (req, res) => {
  const { client_id, service_id, client_status } = req.query;
  const conditions = [`i.agency_id = $1`, `i.due_date IS NOT NULL`, `i.due_date < CURRENT_DATE`, `i.amount > i.paid_amount`];
  const params = [req.user.agencyId];

  if (client_id && client_id !== "all") {
    params.push(client_id);
    conditions.push(`i.client_id = $${params.length}`);
  }
  if (service_id && service_id !== "all") {
    params.push(service_id);
    conditions.push(`i.service_id = $${params.length}`);
  }
  if (client_status && client_status !== "all") {
    params.push(client_status);
    conditions.push(`c.status = $${params.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  try {
    const result = await pool.query(
      `SELECT i.client_id, (i.amount - i.paid_amount) AS remaining,
              (CURRENT_DATE - i.due_date) AS days_overdue
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       ${where}`,
      params
    );

    const buckets = {
      "0-30": { label: "0–30 يوم", total: 0, clients: new Set() },
      "31-60": { label: "31–60 يوم", total: 0, clients: new Set() },
      "61-90": { label: "61–90 يوم", total: 0, clients: new Set() },
      "90+": { label: "أكتر من 90 يوم", total: 0, clients: new Set() },
    };

    result.rows.forEach((r) => {
      const days = Number(r.days_overdue);
      const remaining = Number(r.remaining);
      let key;
      if (days <= 30) key = "0-30";
      else if (days <= 60) key = "31-60";
      else if (days <= 90) key = "61-90";
      else key = "90+";

      buckets[key].total += remaining;
      if (r.client_id) buckets[key].clients.add(r.client_id);
    });

    const grandTotal = Object.values(buckets).reduce((s, b) => s + b.total, 0);

    const report = Object.entries(buckets).map(([key, b]) => ({
      bucket: key,
      label: b.label,
      totalOutstanding: b.total,
      clientCount: b.clients.size,
      percentage: grandTotal > 0 ? (b.total / grandTotal) * 100 : 0,
    }));

    res.json({ totalOutstanding: grandTotal, buckets: report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating aging report" });
  }
});

// GET /api/finance/monthly-trend — last 12 months: revenue, cash collected,
// business expenses, net profit. Optional filters: client_id, service_id, client_status
router.get("/monthly-trend", async (req, res) => {
  const { client_id, service_id, client_status } = req.query;
  const currency = req.query.currency || "EGP";

  try {
    const invConditions = [`i.currency = $1`, `i.agency_id = $2`];
    const invParams = [currency, req.user.agencyId];
    if (client_id && client_id !== "all") { invParams.push(client_id); invConditions.push(`i.client_id = $${invParams.length}`); }
    if (service_id && service_id !== "all") { invParams.push(service_id); invConditions.push(`i.service_id = $${invParams.length}`); }
    if (client_status && client_status !== "all") { invParams.push(client_status); invConditions.push(`c.status = $${invParams.length}`); }

    const invRows = await pool.query(
      `SELECT to_char(i.issue_date,'YYYY-MM') AS month,
              COALESCE(SUM(i.amount),0) AS revenue,
              COALESCE(SUM(i.paid_amount),0) AS cash_collected
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE ${invConditions.join(" AND ")}
       GROUP BY month`,
      invParams
    );

    const expConditions = [`e.currency = $1`, `e.agency_id = $2`, `e.expense_type = 'business'`];
    const expParams = [currency, req.user.agencyId];
    if (client_id && client_id !== "all") { expParams.push(client_id); expConditions.push(`e.related_client_id = $${expParams.length}`); }
    if (service_id && service_id !== "all") { expParams.push(service_id); expConditions.push(`e.related_service_id = $${expParams.length}`); }

    const expRows = await pool.query(
      `SELECT to_char(e.date,'YYYY-MM') AS month, COALESCE(SUM(e.amount),0) AS expenses
       FROM expenses e WHERE ${expConditions.join(" AND ")} GROUP BY month`,
      expParams
    );

    const adRows = (service_id && service_id !== "all") ? [] : await queryAdCommission({ agencyId: req.user.agencyId, currency, client_id, client_status, groupBy: "month" });

    const merged = {};
    const blank = (month) => ({ month, revenue: 0, cashCollected: 0, expenses: 0, adCommission: 0 });
    invRows.rows.forEach((r) => {
      merged[r.month] = { ...blank(r.month), revenue: Number(r.revenue), cashCollected: Number(r.cash_collected) };
    });
    expRows.rows.forEach((r) => {
      if (!merged[r.month]) merged[r.month] = blank(r.month);
      merged[r.month].expenses = Number(r.expenses);
    });
    adRows.forEach((r) => {
      if (!merged[r.k]) merged[r.k] = blank(r.k);
      merged[r.k].adCommission = Number(r.commission);
    });

    const list = Object.values(merged)
      .map((m) => ({ ...m, netProfit: m.cashCollected + m.adCommission - m.expenses }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12)
      .reverse();

    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating monthly trend" });
  }
});

// GET /api/finance/by-service — revenue/expenses/net profit per service.
//
// Revenue attribution logic (hybrid):
//   1) If an invoice has service_id set explicitly, that invoice's amount /
//      paid_amount / outstanding go to that exact service (precise).
//   2) Otherwise, the invoice's amounts are split EQUALLY across every
//      service the client is subscribed to via client_services — so a
//      client's known subscriptions still show up in the report even for
//      invoices nobody manually tagged with a service.
//   3) If the client has zero subscribed services, the invoice falls into
//      the "بدون خدمة محددة" bucket, same as before.
// This guarantees SUM(all services' revenue) === SUM(all invoices' amount)
// exactly — nothing is double-counted or invented.
//
// Client count reflects actual service assignments (client_services), so a
// service shows up even before any invoice references it.
router.get("/by-service", async (req, res) => {
  const { client_id, client_status, date_range, from: customFrom, to: customTo } = req.query;
  const currency = req.query.currency || "EGP";

  try {
    const clientFilterConditions = [`c.agency_id = $1`];
    const clientFilterParams = [req.user.agencyId];
    if (client_status && client_status !== "all") {
      clientFilterParams.push(client_status);
      clientFilterConditions.push(`c.status = $${clientFilterParams.length}`);
    }
    if (client_id && client_id !== "all") {
      clientFilterParams.push(client_id);
      clientFilterConditions.push(`c.id = $${clientFilterParams.length}`);
    }
    // These filters go in the JOIN condition (not WHERE) so services with
    // zero matching clients still appear as a row (with client_count = 0)
    // instead of a WHERE-clause turning the LEFT JOIN into an INNER JOIN.
    const clientJoinExtra = clientFilterConditions.length ? `AND ${clientFilterConditions.join(" AND ")}` : "";

    // Base: every service, with how many (filtered) clients are actually assigned to it
    const servicesResult = await pool.query(
      `SELECT s.id AS service_id, s.name AS service_name,
              COUNT(DISTINCT cs.client_id) AS client_count
       FROM services s
       LEFT JOIN client_services cs ON cs.service_id = s.id
       LEFT JOIN clients c ON c.id = cs.client_id ${clientJoinExtra}
       WHERE s.agency_id = $1
       GROUP BY s.id, s.name
       ORDER BY s.name`,
      clientFilterParams
    );

    // Revenue / cash collected / outstanding per service, from invoices —
    // hybrid attribution as described above.
    const invConditions = [`i.currency = $1`, `i.agency_id = $2`];
    const invParams = [currency, req.user.agencyId];
    if (client_id && client_id !== "all") { invParams.push(client_id); invConditions.push(`i.client_id = $${invParams.length}`); }
    if (client_status && client_status !== "all") { invParams.push(client_status); invConditions.push(`c.status = $${invParams.length}`); }
    if (date_range && date_range !== "all") {
      const { from, to } = resolveDateRange(date_range, customFrom, customTo);
      if (from) { invParams.push(from); invConditions.push(`i.issue_date >= $${invParams.length}`); }
      if (to) { invParams.push(to); invConditions.push(`i.issue_date <= $${invParams.length}`); }
    }

    const invRows = await pool.query(
      `SELECT i.id, i.client_id, i.service_id, i.amount, i.paid_amount
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE ${invConditions.join(" AND ")}`,
      invParams
    );

    // Every client's subscribed service_id list (client_services), used to
    // split invoices that have no explicit service_id.
    const clientServicesResult = await pool.query(
      "SELECT cs.client_id, cs.service_id FROM client_services cs JOIN clients c ON c.id = cs.client_id WHERE c.agency_id = $1",
      [req.user.agencyId]
    );
    const servicesByClient = {};
    clientServicesResult.rows.forEach((r) => {
      if (!servicesByClient[r.client_id]) servicesByClient[r.client_id] = [];
      servicesByClient[r.client_id].push(r.service_id);
    });

    // Accumulate revenue/cashCollected/outstanding per service (plus a null
    // bucket for "unassigned"), splitting equally when an invoice has no
    // service_id but its client has N subscribed services.
    const invByService = {}; // serviceId (or 'null') -> { revenue, cash_collected, outstanding }
    function addToService(key, amount, paid, outstanding) {
      if (!invByService[key]) invByService[key] = { revenue: 0, cash_collected: 0, outstanding: 0 };
      invByService[key].revenue += amount;
      invByService[key].cash_collected += paid;
      invByService[key].outstanding += outstanding;
    }

    invRows.rows.forEach((inv) => {
      const amount = Number(inv.amount);
      const paid = Number(inv.paid_amount);
      const outstanding = amount - paid;

      if (inv.service_id) {
        addToService(inv.service_id, amount, paid, outstanding);
        return;
      }

      const subscribed = servicesByClient[inv.client_id] || [];
      if (subscribed.length === 0) {
        addToService("null", amount, paid, outstanding);
        return;
      }

      const n = subscribed.length;
      subscribed.forEach((svcId) => {
        addToService(svcId, amount / n, paid / n, outstanding / n);
      });
    });

    // Same filters as /summary: expense date range and the related client.
    const svcExpParams = [currency, req.user.agencyId];
    const svcExpCond = [`currency = $1`, `agency_id = $2`, `expense_type = 'business'`];
    if (client_id && client_id !== "all") { svcExpParams.push(client_id); svcExpCond.push(`related_client_id = $${svcExpParams.length}`); }
    if (date_range && date_range !== "all") {
      const { from, to } = resolveDateRange(date_range, customFrom, customTo);
      if (from) { svcExpParams.push(from); svcExpCond.push(`date >= $${svcExpParams.length}`); }
      if (to) { svcExpParams.push(to); svcExpCond.push(`date <= $${svcExpParams.length}`); }
    }
    const expRows = await pool.query(
      `SELECT related_service_id AS service_id, COALESCE(SUM(amount),0) AS expenses
       FROM expenses WHERE ${svcExpCond.join(" AND ")}
       GROUP BY related_service_id`,
      svcExpParams
    );
    const expByService = {};
    expRows.rows.forEach((r) => { expByService[r.service_id] = Number(r.expenses); });

    // Ad-budget commission per service. Ad budgets only record a platform, so
    // map it to the matching "إعلانات ..." service by name; platforms that
    // match no service (e.g. "other") fall into the unassigned bucket.
    let adFrom = null, adTo = null;
    if (date_range && date_range !== "all") ({ from: adFrom, to: adTo } = resolveDateRange(date_range, customFrom, customTo));
    const PLATFORM_KEYWORDS = { meta: "ميتا", google: "جوجل", tiktok: "تيك توك", snapchat: "سناب" };
    const adByService = {}; // serviceId (or "null") -> commission
    (await queryAdCommission({ agencyId: req.user.agencyId, currency, client_id, client_status, from: adFrom, to: adTo, groupBy: "platform" })).forEach((r) => {
      const kw = PLATFORM_KEYWORDS[r.k];
      const svc = kw ? servicesResult.rows.find((s) => s.service_name.includes(kw)) : null;
      const key = svc ? svc.service_id : "null";
      adByService[key] = (adByService[key] || 0) + Number(r.commission);
    });

    // Unassigned-service bucket (invoices/expenses with no service resolvable)
    const unassignedInv = invByService["null"];
    const unassignedExp = expByService[null] ?? expByService[undefined] ?? 0;

    const round2 = (n) => Math.round(n * 100) / 100;

    const result = servicesResult.rows.map((s) => {
      const inv = invByService[s.service_id];
      const revenue = inv ? round2(Number(inv.revenue)) : 0;
      const cashCollected = inv ? round2(Number(inv.cash_collected)) : 0;
      const outstanding = inv ? round2(Number(inv.outstanding)) : 0;
      const expenses = expByService[s.service_id] || 0;
      const adCommission = round2(adByService[s.service_id] || 0);
      const income = cashCollected + adCommission;
      const netProfit = round2(income - expenses);
      return {
        serviceId: s.service_id,
        serviceName: s.service_name,
        clientCount: Number(s.client_count),
        revenue,
        cashCollected,
        adCommission,
        outstanding,
        expenses,
        netProfit,
        profitMargin: income > 0 ? (netProfit / income) * 100 : 0,
      };
    });

    // Include a bucket for invoices/expenses that were never tagged with a service
    const unassignedAd = round2(adByService["null"] || 0);
    if (unassignedInv || unassignedExp || unassignedAd) {
      const revenue = unassignedInv ? round2(Number(unassignedInv.revenue)) : 0;
      const cashCollected = unassignedInv ? round2(Number(unassignedInv.cash_collected)) : 0;
      const outstanding = unassignedInv ? round2(Number(unassignedInv.outstanding)) : 0;
      const income = cashCollected + unassignedAd;
      const netProfit = round2(income - unassignedExp);
      result.push({
        serviceId: null,
        serviceName: "بدون خدمة محددة",
        clientCount: 0,
        revenue,
        cashCollected,
        adCommission: unassignedAd,
        outstanding,
        expenses: unassignedExp,
        netProfit,
        profitMargin: income > 0 ? (netProfit / income) * 100 : 0,
      });
    }

    result.sort((a, b) => b.revenue - a.revenue);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating service breakdown" });
  }
});

// GET /api/finance/client-growth — new clients per month, last 12 months
router.get("/client-growth", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT to_char(created_at,'YYYY-MM') AS month, COUNT(*) AS new_clients
       FROM clients WHERE agency_id = $1 GROUP BY month ORDER BY month DESC LIMIT 12`,
      [req.user.agencyId]
    );
    res.json(result.rows.reverse().map((r) => ({ month: r.month, newClients: Number(r.new_clients) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating client growth" });
  }
});

// GET /api/finance/client-profitability
// Optional query params: client_status
router.get("/client-profitability", async (req, res) => {
  const { client_id, service_id, client_status, date_range, from: customFrom, to: customTo } = req.query;
  const currency = req.query.currency || "EGP";

  try {
    const clientConditions = ["c.agency_id = $1"];
    const clientParams = [req.user.agencyId];
    if (client_status && client_status !== "all") {
      clientParams.push(client_status);
      clientConditions.push(`c.status = $${clientParams.length}`);
    }

    // Same global filters as /summary so the numbers always tie out:
    // date_range (invoice issue date / expense date / ad received date),
    // client_id and service_id.
    let from = null, to = null;
    if (date_range && date_range !== "all") ({ from, to } = resolveDateRange(date_range, customFrom, customTo));
    const filterClient = client_id && client_id !== "all";
    const filterService = service_id && service_id !== "all";

    if (filterClient) {
      clientParams.push(client_id);
      clientConditions.push(`c.id = $${clientParams.length}`);
    }

    const invParams = [currency, req.user.agencyId];
    const invCond = [`currency = $1`, `agency_id = $2`];
    if (filterClient) { invParams.push(client_id); invCond.push(`client_id = $${invParams.length}`); }
    if (filterService) { invParams.push(service_id); invCond.push(`service_id = $${invParams.length}`); }
    if (from) { invParams.push(from); invCond.push(`issue_date >= $${invParams.length}`); }
    if (to) { invParams.push(to); invCond.push(`issue_date <= $${invParams.length}`); }
    const invRows = await pool.query(
      `SELECT client_id,
              COALESCE(SUM(amount),0) AS revenue,
              COALESCE(SUM(paid_amount),0) AS cash_collected,
              COALESCE(SUM(amount - paid_amount),0) AS outstanding
       FROM invoices WHERE ${invCond.join(" AND ")} GROUP BY client_id`,
      invParams
    );
    const invByClient = {};
    invRows.rows.forEach((r) => { invByClient[r.client_id] = r; });

    const expParams = [currency, req.user.agencyId];
    const expCond = [`currency = $1`, `agency_id = $2`, `expense_type = 'business'`, `related_client_id IS NOT NULL`];
    if (filterClient) { expParams.push(client_id); expCond.push(`related_client_id = $${expParams.length}`); }
    if (filterService) { expParams.push(service_id); expCond.push(`related_service_id = $${expParams.length}`); }
    if (from) { expParams.push(from); expCond.push(`date >= $${expParams.length}`); }
    if (to) { expParams.push(to); expCond.push(`date <= $${expParams.length}`); }
    const expRows = await pool.query(
      `SELECT related_client_id AS client_id, COALESCE(SUM(amount),0) AS client_expenses
       FROM expenses
       WHERE ${expCond.join(" AND ")}
       GROUP BY related_client_id`,
      expParams
    );
    const expByClient = {};
    expRows.rows.forEach((r) => { expByClient[r.client_id] = Number(r.client_expenses); });

    const adByClient = {};
    if (!filterService) {
      (await queryAdCommission({ agencyId: req.user.agencyId, currency, client_id, from, to, groupBy: "client" })).forEach((r) => { adByClient[r.k] = Number(r.commission); });
    }

    const clientWhere = clientConditions.length ? `WHERE ${clientConditions.join(" AND ")}` : "";
    const clientsResult = await pool.query(`SELECT c.id, c.name, c.status FROM clients c ${clientWhere}`, clientParams);

    const rows = clientsResult.rows.map((c) => {
      const inv = invByClient[c.id];
      const revenue = inv ? Number(inv.revenue) : 0;
      const cashCollected = inv ? Number(inv.cash_collected) : 0;
      const outstandingBalance = inv ? Number(inv.outstanding) : 0;
      const clientExpenses = expByClient[c.id] || 0;
      const adCommission = adByClient[c.id] || 0;
      const income = cashCollected + adCommission;
      const netProfit = income - clientExpenses;
      const profitMargin = income > 0 ? (netProfit / income) * 100 : 0;

      return {
        adCommission,
        clientId: c.id,
        clientName: c.name,
        clientStatus: c.status,
        revenue,
        cashCollected,
        outstandingBalance,
        clientExpenses,
        netProfit,
        profitMargin,
      };
    });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating client profitability" });
  }
});

// GET /api/finance/client-health — 0-100 health score per client
// Optional query params: client_status
router.get("/client-health", async (req, res) => {
  const { client_status } = req.query;
  const currency = req.query.currency || "EGP";
  const today = new Date().toISOString().slice(0, 10);

  try {
    const clientConditions = ["agency_id = $1"];
    const clientParams = [req.user.agencyId];
    if (client_status && client_status !== "all") {
      clientParams.push(client_status);
      clientConditions.push(`status = $${clientParams.length}`);
    }
    const clientWhere = clientConditions.length ? `WHERE ${clientConditions.join(" AND ")}` : "";
    const clientsResult = await pool.query(`SELECT * FROM clients ${clientWhere}`, clientParams);

    const invResult = await pool.query(
      `SELECT client_id, amount, paid_amount, due_date FROM invoices WHERE currency = $1 AND agency_id = $2`,
      [currency, req.user.agencyId]
    );
    const invByClient = {};
    invResult.rows.forEach((r) => {
      if (!invByClient[r.client_id]) invByClient[r.client_id] = [];
      invByClient[r.client_id].push(r);
    });

    // Average revenue across clients that actually have invoices, used as
    // the yardstick for the "client value" factor below.
    const revenueByClient = {};
    Object.entries(invByClient).forEach(([cid, invs]) => {
      revenueByClient[cid] = invs.reduce((s, i) => s + Number(i.amount), 0);
    });
    const revenueValues = Object.values(revenueByClient);
    const avgRevenue = revenueValues.length > 0 ? revenueValues.reduce((a, b) => a + b, 0) / revenueValues.length : 0;

    const results = clientsResult.rows.map((c) => {
      const invs = invByClient[c.id] || [];
      const health = computeHealthScore(c, invs, avgRevenue, today);
      return { clientId: c.id, clientName: c.name, clientStatus: c.status, ...health };
    }).sort((a, b) => a.score - b.score);

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating client health scores" });
  }
});

// GET /api/finance/renewal-analytics
router.get("/renewal-analytics", async (req, res) => {
  try {
    const clientsResult = await pool.query("SELECT * FROM clients WHERE agency_id = $1", [req.user.agencyId]);
    const today = new Date().toISOString().slice(0, 10);

    function addMonths(iso, months) {
      const d = new Date(iso);
      d.setMonth(d.getMonth() + months);
      return d.toISOString().slice(0, 10);
    }
    function nextRenewalDate(client) {
      const cycle = client.renewal_cycle || "once";
      const cycleMonths = cycle === "monthly" ? 1 : cycle === "quarterly" ? 3 : cycle === "yearly" ? 12 : null;
      const anchor = client.contract_end || client.contract_start;
      if (!anchor) return null;
      const anchorStr = anchor.toISOString().slice(0, 10);
      if (!cycleMonths) return anchorStr;
      let next = anchorStr;
      let guard = 0;
      while (next < today && guard < 600) { next = addMonths(next, cycleMonths); guard++; }
      return next;
    }
    function categoryFor(client) {
      if (client.status === "Stopped" || client.status === "Expired") return "Expired";
      if (client.status === "Suspended") return "AtRisk";
      if (client.status === "Active") {
        return client.renewal_cycle === "once" ? "Pending" : "Confirmed";
      }
      return "Pending";
    }

    const withRenewal = clientsResult.rows
      .map((c) => {
        const target = nextRenewalDate(c);
        if (!target) return null;
        const daysUntil = Math.round((new Date(target) - new Date(today)) / 86400000);
        return { clientId: c.id, clientName: c.name, status: c.status, renewalCycle: c.renewal_cycle, target, daysUntil, category: categoryFor(c) };
      })
      .filter(Boolean);

    const windows = [7, 30, 60, 90].reduce((acc, n) => {
      const inWindow = withRenewal.filter((r) => r.daysUntil >= 0 && r.daysUntil <= n);
      acc[n] = {
        confirmed: inWindow.filter((r) => r.category === "Confirmed").length,
        pending: inWindow.filter((r) => r.category === "Pending").length,
        atRisk: inWindow.filter((r) => r.category === "AtRisk").length,
        expired: inWindow.filter((r) => r.category === "Expired").length,
        clients: inWindow,
      };
      return acc;
    }, {});

    const activeCount = clientsResult.rows.filter((c) => c.status === "Active").length;
    const stoppedCount = clientsResult.rows.filter((c) => c.status === "Stopped").length;
    const expiredCount = clientsResult.rows.filter((c) => c.status === "Expired").length;
    const renewalBase = activeCount + stoppedCount + expiredCount;
    const renewalRate = renewalBase > 0 ? (activeCount / renewalBase) * 100 : 0;

    res.json({ windows, renewalRate, activeCount, stoppedCount, expiredCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating renewal analytics" });
  }
});

// GET /api/finance/cash-flow-forecast
router.get("/cash-flow-forecast", async (req, res) => {
  const currency = req.query.currency || "EGP";
  const today = new Date().toISOString().slice(0, 10);

  function addMonths(iso, months) {
    const d = new Date(iso);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }
  function cycleMonthsFor(cycle) {
    if (cycle === "monthly") return 1;
    if (cycle === "quarterly") return 3;
    if (cycle === "yearly") return 12;
    return null;
  }
  // Counts how many billing occurrences of a recurring contract fall inside
  // (today, windowEnd], rolling the anchor date forward cycle-by-cycle.
  function countOccurrences(anchor, cycleMonths, windowEnd) {
    let next = anchor;
    let guard = 0;
    while (next <= today && guard < 600) { next = addMonths(next, cycleMonths); guard++; }
    let count = 0;
    guard = 0;
    while (next <= windowEnd && guard < 600) { count++; next = addMonths(next, cycleMonths); guard++; }
    return count;
  }

  try {
    const clientsResult = await pool.query("SELECT * FROM clients WHERE currency = $1 AND agency_id = $2", [currency, req.user.agencyId]);

    const invResult = await pool.query(
      "SELECT client_id, amount, paid_amount, due_date FROM invoices WHERE currency = $1 AND agency_id = $2 AND amount > paid_amount",
      [currency, req.user.agencyId]
    );
    const overdueTotal = invResult.rows
      .filter((i) => i.due_date && i.due_date.toISOString().slice(0, 10) < today)
      .reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount)), 0);

    const periods = [1, 3, 6].reduce((acc, months) => {
      const windowEnd = addMonths(today, months);

      let confirmed = 0;
      let atRiskRecurring = 0;
      clientsResult.rows.forEach((c) => {
        const cycleMonths = cycleMonthsFor(c.renewal_cycle);
        if (!cycleMonths) return; // one-time contracts handled via "expected" below
        const anchor = (c.contract_end || c.contract_start);
        if (!anchor) return;
        const anchorStr = anchor.toISOString().slice(0, 10);
        const occurrences = countOccurrences(anchorStr, cycleMonths, windowEnd);
        const projected = occurrences * Number(c.contract_value);
        if (c.status === "Active") confirmed += projected;
        else if (c.status === "Suspended") atRiskRecurring += projected;
      });

      // Expected: already-issued invoices due (not yet overdue) within the window
      const expectedFromInvoices = invResult.rows
        .filter((i) => {
          if (!i.due_date) return false;
          const d = i.due_date.toISOString().slice(0, 10);
          return d >= today && d <= windowEnd;
        })
        .reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount)), 0);

      // Expected: Active one-time contracts ending within the window
      const expectedFromOnceOff = clientsResult.rows
        .filter((c) => c.status === "Active" && c.renewal_cycle === "once" && c.contract_end)
        .filter((c) => {
          const d = c.contract_end.toISOString().slice(0, 10);
          return d >= today && d <= windowEnd;
        })
        .reduce((s, c) => s + Number(c.contract_value), 0);

      acc[months] = {
        confirmed: Math.round(confirmed),
        expected: Math.round(expectedFromInvoices + expectedFromOnceOff),
        atRisk: Math.round(atRiskRecurring + overdueTotal),
      };
      return acc;
    }, {});

    res.json({ currency, overdueTotal: Math.round(overdueTotal), periods });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating cash flow forecast" });
  }
});

// GET /api/finance/alerts — unified alert feed across the whole system
router.get("/alerts", async (req, res) => {
  const currency = req.query.currency || "EGP";
  const today = new Date().toISOString().slice(0, 10);
  const HIGH_OUTSTANDING_THRESHOLD = 10000;

  function addDays(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function addMonths(iso, months) {
    const d = new Date(iso);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }
  function nextRenewalDate(client) {
    const cycle = client.renewal_cycle || "once";
    const cycleMonths = cycle === "monthly" ? 1 : cycle === "quarterly" ? 3 : cycle === "yearly" ? 12 : null;
    const anchor = client.contract_end || client.contract_start;
    if (!anchor) return null;
    const anchorStr = anchor.toISOString().slice(0, 10);
    if (!cycleMonths) return anchorStr;
    let next = anchorStr;
    let guard = 0;
    while (next < today && guard < 600) { next = addMonths(next, cycleMonths); guard++; }
    return next;
  }

  try {
    const alerts = [];

    const clientsResult = await pool.query("SELECT * FROM clients WHERE currency = $1 AND agency_id = $2", [currency, req.user.agencyId]);
    const invResult = await pool.query(
      `SELECT i.*, c.name AS client_name FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.currency = $1 AND i.agency_id = $2 AND i.amount > i.paid_amount`,
      [currency, req.user.agencyId]
    );

    // 1) Overdue payments + 2) Payment due soon (from unpaid invoices)
    invResult.rows.forEach((i) => {
      if (!i.due_date) return;
      const dueStr = i.due_date.toISOString().slice(0, 10);
      const remaining = Number(i.amount) - Number(i.paid_amount);
      if (dueStr < today) {
        const daysOverdue = Math.round((new Date(today) - new Date(dueStr)) / 86400000);
        alerts.push({
          type: "OverduePayment", severity: daysOverdue > 30 ? "high" : "medium",
          message: `فاتورة ${i.number} متأخرة ${daysOverdue} يوم`,
          clientId: i.client_id, clientName: i.client_name, amount: remaining, date: dueStr,
        });
      } else if (dueStr <= addDays(today, 3)) {
        alerts.push({
          type: "PaymentDueSoon", severity: "low",
          message: `فاتورة ${i.number} مستحقة قريبًا`,
          clientId: i.client_id, clientName: i.client_name, amount: remaining, date: dueStr,
        });
      }
    });

    // 3) Upcoming renewals + 4) Contract expiration needing a decision
    clientsResult.rows.forEach((c) => {
      if (c.status !== "Active" && c.status !== "Suspended") return;
      const target = nextRenewalDate(c);
      if (!target) return;
      const daysUntil = Math.round((new Date(target) - new Date(today)) / 86400000);
      if (daysUntil < 0) return;

      if (c.renewal_cycle === "once" && c.status === "Active" && daysUntil <= 30) {
        alerts.push({
          type: "ContractExpiration", severity: daysUntil <= 7 ? "high" : "medium",
          message: `عقد "${c.name}" (مرة واحدة) هينتهي خلال ${daysUntil} يوم — محتاج قرار تجديد يدوي`,
          clientId: c.id, clientName: c.name, amount: Number(c.contract_value), date: target,
        });
      } else if (c.renewal_cycle !== "once" && daysUntil <= 7) {
        alerts.push({
          type: "UpcomingRenewal", severity: "low",
          message: `عقد "${c.name}" هيتجدد تلقائيًا خلال ${daysUntil} يوم`,
          clientId: c.id, clientName: c.name, amount: Number(c.contract_value), date: target,
        });
      }
    });

    // 5) High outstanding balance per client
    const outstandingByClient = {};
    invResult.rows.forEach((i) => {
      const remaining = Number(i.amount) - Number(i.paid_amount);
      outstandingByClient[i.client_id] = (outstandingByClient[i.client_id] || 0) + remaining;
    });
    Object.entries(outstandingByClient).forEach(([clientId, total]) => {
      if (total > HIGH_OUTSTANDING_THRESHOLD) {
        const client = clientsResult.rows.find((c) => String(c.id) === String(clientId));
        alerts.push({
          type: "HighOutstandingBalance", severity: "high",
          message: `رصيد مستحق مرتفع على "${client ? client.name : "عميل"}"`,
          clientId: Number(clientId), clientName: client ? client.name : null, amount: total, date: null,
        });
      }
    });

    // 6) Clients at risk — uses the EXACT same computeHealthScore() function
    // as /client-health, so the two endpoints always agree.
    const allInvResult = await pool.query(
      "SELECT client_id, amount, paid_amount, due_date FROM invoices WHERE currency = $1 AND agency_id = $2",
      [currency, req.user.agencyId]
    );
    const invByClient = {};
    allInvResult.rows.forEach((r) => {
      if (!invByClient[r.client_id]) invByClient[r.client_id] = [];
      invByClient[r.client_id].push(r);
    });
    const revenueByClient = {};
    Object.entries(invByClient).forEach(([cid, invs]) => {
      revenueByClient[cid] = invs.reduce((s, i) => s + Number(i.amount), 0);
    });
    const revenueValues = Object.values(revenueByClient);
    const avgRevenue = revenueValues.length > 0 ? revenueValues.reduce((a, b) => a + b, 0) / revenueValues.length : 0;

    clientsResult.rows.forEach((c) => {
      if (c.status !== "Active" && c.status !== "Suspended") return;
      const invs = invByClient[c.id] || [];
      const health = computeHealthScore(c, invs, avgRevenue, today);
      if (health.category === "AtRisk") {
        alerts.push({
          type: "ClientAtRisk", severity: "high",
          message: `"${c.name}" في خطر (الدرجة: ${health.score}) — يحتاج متابعة فورية`,
          clientId: c.id, clientName: c.name, amount: null, date: null,
        });
      }
    });

    const severityOrder = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const counts = { high: 0, medium: 0, low: 0 };
    alerts.forEach((a) => { counts[a.severity]++; });

    res.json({ total: alerts.length, counts, alerts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating alerts" });
  }
});

// GET /api/finance/personal-summary — KPI cards for the "المصاريف الشخصية" tab
// Fixed-window figures (this month / this year) per the spec, independent
// of the global date filter — plus averages/highs computed from all-time data.
router.get("/personal-summary", async (req, res) => {
  if (!can(req.user, "personal_expenses", "view")) {
    return res.status(403).json({ error: "ليس لديك صلاحية لتنفيذ هذا الإجراء", code: "forbidden" });
  }
  const currency = req.query.currency || "EGP";
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const yearStart = `${today.getFullYear()}-01-01`;
  const todayISO = today.toISOString().slice(0, 10);

  try {
    const rows = (await pool.query(
      "SELECT amount, date, category FROM expenses WHERE currency = $1 AND agency_id = $2 AND expense_type = 'personal'",
      [currency, req.user.agencyId]
    )).rows;

    const totalThisMonth = rows
      .filter((r) => r.date.toISOString().slice(0, 10) >= monthStart)
      .reduce((s, r) => s + Number(r.amount), 0);
    const totalThisYear = rows
      .filter((r) => r.date.toISOString().slice(0, 10) >= yearStart)
      .reduce((s, r) => s + Number(r.amount), 0);

    const byMonth = {};
    rows.forEach((r) => {
      const key = r.date.toISOString().slice(0, 7);
      byMonth[key] = (byMonth[key] || 0) + Number(r.amount);
    });
    const monthEntries = Object.entries(byMonth);
    const avgMonthly = monthEntries.length > 0
      ? monthEntries.reduce((s, [, v]) => s + v, 0) / monthEntries.length
      : 0;
    const highestMonthEntry = monthEntries.sort((a, b) => b[1] - a[1])[0] || null;

    const byCategory = {};
    rows.forEach((r) => {
      const key = r.category || "أخرى";
      byCategory[key] = (byCategory[key] || 0) + Number(r.amount);
    });
    const topCategoryEntry = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0] || null;

    res.json({
      currency,
      totalThisMonth,
      totalThisYear,
      avgMonthly: Math.round(avgMonthly * 100) / 100,
      highestMonth: highestMonthEntry ? { month: highestMonthEntry[0], amount: highestMonthEntry[1] } : null,
      topCategory: topCategoryEntry ? { category: topCategoryEntry[0], amount: topCategoryEntry[1] } : null,
      count: rows.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating personal expense summary" });
  }
});

// GET /api/finance/expense-categories — breakdown by category, for either
// company or personal expenses (used by both tabs' pie/bar charts).
// Optional query params: expense_type ('business'|'personal', default business),
// date_range (+ from/to for "custom")
router.get("/expense-categories", async (req, res) => {
  const currency = req.query.currency || "EGP";
  const expenseType = req.query.expense_type === "personal" ? "personal" : "business";
  const { date_range, from: customFrom, to: customTo } = req.query;

  if (!can(req.user, expenseType === "personal" ? "personal_expenses" : "expenses", "view")) {
    return res.status(403).json({ error: "ليس لديك صلاحية لتنفيذ هذا الإجراء", code: "forbidden" });
  }
  const conditions = [`currency = $1`, `expense_type = $2`, `agency_id = $3`];
  const params = [currency, expenseType, req.user.agencyId];
  if (date_range && date_range !== "all") {
    const { from, to } = resolveDateRange(date_range, customFrom, customTo);
    if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`date <= $${params.length}`); }
  }

  try {
    const result = await pool.query(
      `SELECT category, COALESCE(SUM(amount),0) AS amount, COUNT(*) AS count
       FROM expenses WHERE ${conditions.join(" AND ")}
       GROUP BY category ORDER BY amount DESC`,
      params
    );
    const total = result.rows.reduce((s, r) => s + Number(r.amount), 0);
    res.json({
      total,
      categories: result.rows.map((r) => ({
        category: r.category || "أخرى",
        amount: Number(r.amount),
        count: Number(r.count),
        percentage: total > 0 ? (Number(r.amount) / total) * 100 : 0,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating expense category breakdown" });
  }
});

module.exports = router;
