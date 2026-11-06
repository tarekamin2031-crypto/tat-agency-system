const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveDateRange } = require("../utils/dateRange");
const { getCompany } = require("../lib/company");
const { audit, fetchBefore } = require("../lib/audit");
const { ownsRow } = require("../lib/tenant");

const router = express.Router();
router.use(requireAuth);

// GET /api/ad-budgets
// Optional query params (Global Filter System): client_id, client_status, date_range (+ from/to)
router.get("/", requirePermission("ad_budgets", "view"), async (req, res) => {
  const { client_id, client_status, date_range, from: customFrom, to: customTo } = req.query;
  const conditions = ["ab.agency_id = $1"];
  const params = [req.user.agencyId];

  if (client_id && client_id !== "all") {
    params.push(client_id);
    conditions.push(`ab.client_id = $${params.length}`);
  }
  if (client_status && client_status !== "all") {
    params.push(client_status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (date_range && date_range !== "all") {
    const { from, to } = resolveDateRange(date_range, customFrom, customTo);
    if (from) { params.push(from); conditions.push(`ab.received_date >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`ab.received_date <= $${params.length}`); }
  }

  const result = await pool.query(
    `SELECT ab.*, c.name AS client_name, c.status AS client_status
     FROM ad_budgets ab
     LEFT JOIN clients c ON c.id = ab.client_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY ab.received_date DESC`,
    params
  );
  res.json(result.rows);
});

// POST /api/ad-budgets
router.post("/", requirePermission("ad_budgets", "create"), async (req, res) => {
  const b = req.body;
  try {
    if (!(await ownsRow("clients", b.client_id, req.user.agencyId))) return res.status(400).json({ error: "Invalid client" });
    // When the form doesn't send a rate, use the company's default (Settings → Company).
    const defaultRate = b.commission_rate ?? (await getCompany(req.user.agencyId)).default_commission_rate;
    const result = await pool.query(
      `INSERT INTO ad_budgets (client_id, platform, amount_received, currency, commission_rate, received_date, notes, created_by, agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        b.client_id || null, b.platform || "meta", b.amount_received || 0,
        b.currency || "EGP", defaultRate,
        b.received_date || new Date().toISOString().slice(0, 10), b.notes || null, req.user.id, req.user.agencyId,
      ]
    );
    audit(req, { action: "ad_budget.create", entity: "ad_budget", entityId: result.rows[0].id, after: result.rows[0], summary: `${result.rows[0].platform} ${result.rows[0].amount_received}` });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating ad budget entry" });
  }
});

// PUT /api/ad-budgets/:id
router.put("/:id", requirePermission("ad_budgets", "edit"), async (req, res) => {
  const b = req.body;
  try {
    if (!(await ownsRow("clients", b.client_id, req.user.agencyId))) return res.status(400).json({ error: "Invalid client" });
    const before = await fetchBefore("ad_budgets", req.params.id, req.user.agencyId);
    const result = await pool.query(
      `UPDATE ad_budgets SET client_id=$1, platform=$2, amount_received=$3, currency=$4,
        commission_rate=$5, received_date=$6, notes=$7
       WHERE id=$8 AND agency_id=$9 RETURNING *`,
      [
        b.client_id || null, b.platform || "meta", b.amount_received || 0,
        b.currency || "EGP", b.commission_rate ?? 20, b.received_date, b.notes || null, req.params.id, req.user.agencyId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Entry not found" });
    audit(req, { action: "ad_budget.update", entity: "ad_budget", entityId: req.params.id, before, after: result.rows[0], summary: `${result.rows[0].platform}` });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating ad budget entry" });
  }
});

// DELETE /api/ad-budgets/:id
router.delete("/:id", requirePermission("ad_budgets", "delete"), async (req, res) => {
  const before = await fetchBefore("ad_budgets", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Entry not found" });
  await pool.query("DELETE FROM ad_budgets WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  audit(req, { action: "ad_budget.delete", entity: "ad_budget", entityId: req.params.id, before, summary: `${before.platform} ${before.amount_received}` });
  res.status(204).send();
});

// GET /api/ad-budgets/report/summary — totals + per-client + monthly breakdown
router.get("/report/summary", requirePermission("ad_budgets", "view"), async (req, res) => {
  const currency = req.query.currency || "EGP";
  const agencyId = req.user.agencyId;
  try {
    const totalsResult = await pool.query(
      `SELECT
          COALESCE(SUM(amount_received),0) AS total_received,
          COALESCE(SUM(commission_amount),0) AS total_commission,
          COALESCE(SUM(net_ad_amount),0) AS total_net,
          COUNT(*) AS entry_count
       FROM ad_budgets WHERE currency = $1 AND agency_id = $2`,
      [currency, agencyId]
    );

    const byClientResult = await pool.query(
      `SELECT ab.client_id, c.name AS client_name,
              COALESCE(SUM(ab.amount_received),0) AS total_received,
              COALESCE(SUM(ab.commission_amount),0) AS total_commission,
              COALESCE(SUM(ab.net_ad_amount),0) AS total_net,
              COUNT(*) AS entry_count
       FROM ad_budgets ab
       LEFT JOIN clients c ON c.id = ab.client_id
       WHERE ab.currency = $1 AND ab.agency_id = $2
       GROUP BY ab.client_id, c.name
       ORDER BY total_received DESC`,
      [currency, agencyId]
    );

    const byMonthResult = await pool.query(
      `SELECT to_char(received_date, 'YYYY-MM') AS month,
              COALESCE(SUM(amount_received),0) AS total_received,
              COALESCE(SUM(commission_amount),0) AS total_commission,
              COALESCE(SUM(net_ad_amount),0) AS total_net
       FROM ad_budgets WHERE currency = $1 AND agency_id = $2
       GROUP BY month ORDER BY month DESC LIMIT 12`,
      [currency, agencyId]
    );

    const byPlatformResult = await pool.query(
      `SELECT platform,
              COALESCE(SUM(amount_received),0) AS total_received,
              COALESCE(SUM(commission_amount),0) AS total_commission
       FROM ad_budgets WHERE currency = $1 AND agency_id = $2
       GROUP BY platform ORDER BY total_received DESC`,
      [currency, agencyId]
    );

    res.json({
      ...totalsResult.rows[0],
      byClient: byClientResult.rows,
      byMonth: byMonthResult.rows,
      byPlatform: byPlatformResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating ad budget report" });
  }
});

module.exports = router;
