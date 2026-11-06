const express = require("express");
const pool = require("../db/pool");
const { requireAuth, can } = require("../middleware/auth");
const { resolveDateRange } = require("../utils/dateRange");
const { audit, fetchBefore } = require("../lib/audit");
const { ownsAll } = require("../lib/tenant");

const router = express.Router();
router.use(requireAuth);

// Company expenses and the CEO's personal expenses are separate permission
// modules, so an accountant can manage the former without ever seeing the latter.
const typeOf = (v) => (v === "personal" ? "personal" : "business");
const moduleFor = (type) => (type === "personal" ? "personal_expenses" : "expenses");
const deny = (res) => res.status(403).json({ error: "ليس لديك صلاحية لتنفيذ هذا الإجراء", code: "forbidden" });

const RETURNING = `id, name, category, description, notes, amount, currency, date,
        related_client_id, related_service_id, expense_type, payment_method, created_by, created_at, updated_at,
        (screenshot_data IS NOT NULL) AS has_screenshot`;

// GET /api/expenses
// Optional query params: category, expense_type ('business'|'personal'),
// date_range (+ from/to for "custom"), search
// has_screenshot flag is included so list views can show a small indicator
// without pulling the (potentially large) image bytes.
router.get("/", async (req, res) => {
  const { category, expense_type, date_range, from: customFrom, to: customTo, search } = req.query;
  const allowed = ["business", "personal"].filter((t) => can(req.user, moduleFor(t), "view"));
  if (!allowed.length) return deny(res);

  const conditions = ["agency_id = $1"];
  const params = [req.user.agencyId];
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (expense_type === "business" || expense_type === "personal") {
    if (!allowed.includes(expense_type)) return deny(res);
    params.push(expense_type);
    conditions.push(`expense_type = $${params.length}`);
  } else {
    // no explicit type: return only the types this user may see
    params.push(allowed);
    conditions.push(`expense_type = ANY($${params.length}::text[])`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  if (date_range && date_range !== "all") {
    const { from, to } = resolveDateRange(date_range, customFrom, customTo);
    if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`date <= $${params.length}`); }
  }
  const result = await pool.query(
    `SELECT ${RETURNING.replace("created_by, created_at, updated_at,", "created_by, created_at, updated_at,")}
     FROM expenses WHERE ${conditions.join(" AND ")} ORDER BY date DESC`,
    params
  );
  res.json(result.rows);
});

// GET /api/expenses/:id/screenshot — serves the stored image bytes directly
router.get("/:id/screenshot", async (req, res) => {
  const result = await pool.query(
    "SELECT screenshot_data, screenshot_mime, expense_type FROM expenses WHERE id = $1 AND agency_id = $2",
    [req.params.id, req.user.agencyId]
  );
  const row = result.rows[0];
  if (!row || !row.screenshot_data) return res.status(404).json({ error: "No screenshot for this expense" });
  if (!can(req.user, moduleFor(row.expense_type), "view")) return deny(res);
  res.setHeader("Content-Type", row.screenshot_mime || "image/png");
  res.send(row.screenshot_data);
});

function parseScreenshot(e) {
  let buffer = null;
  let mime = e.screenshot_mime || null;
  if (e.screenshot_base64) {
    const match = e.screenshot_base64.match(/^data:(.+);base64,(.*)$/);
    if (match) {
      mime = match[1];
      buffer = Buffer.from(match[2], "base64");
    } else {
      buffer = Buffer.from(e.screenshot_base64, "base64");
    }
  }
  return { buffer, mime };
}

// POST /api/expenses
// Optional body fields: screenshot_base64 (data URI or raw base64), screenshot_mime
router.post("/", async (req, res) => {
  const e = req.body;
  const type = typeOf(e.expense_type);
  if (!can(req.user, moduleFor(type), "create")) return deny(res);
  try {
    if (!(await ownsAll([["clients", e.related_client_id], ["services", e.related_service_id]], req.user.agencyId))) {
      return res.status(400).json({ error: "Invalid client or service" });
    }
    const { buffer, mime } = parseScreenshot(e);
    const result = await pool.query(
      `INSERT INTO expenses
        (name, category, description, notes, amount, currency, date, related_client_id, related_service_id,
         expense_type, payment_method, screenshot_data, screenshot_mime, created_by, agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${RETURNING}`,
      [
        e.name || null, e.category, e.description || null, e.notes || null,
        e.amount || 0, e.currency || "EGP", e.date || new Date().toISOString().slice(0, 10),
        e.related_client_id || null, e.related_service_id || null,
        type, e.payment_method || null,
        buffer, mime, req.user.id, req.user.agencyId,
      ]
    );
    audit(req, { action: "expense.create", entity: "expense", entityId: result.rows[0].id, after: result.rows[0], summary: `${result.rows[0].name || result.rows[0].category} (${type})` });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating expense" });
  }
});

// PUT /api/expenses/:id
// If screenshot_base64 is omitted, the existing screenshot (if any) is kept as-is.
router.put("/:id", async (req, res) => {
  const e = req.body;
  try {
    const before = await fetchBefore("expenses", req.params.id, req.user.agencyId);
    if (!before) return res.status(404).json({ error: "Expense not found" });
    const newType = typeOf(e.expense_type);
    // needs edit rights on the current type AND on the new one (when it changes)
    if (!can(req.user, moduleFor(before.expense_type), "edit") || !can(req.user, moduleFor(newType), "edit")) return deny(res);
    if (!(await ownsAll([["clients", e.related_client_id], ["services", e.related_service_id]], req.user.agencyId))) {
      return res.status(400).json({ error: "Invalid client or service" });
    }

    const { buffer, mime } = parseScreenshot(e);
    const setScreenshot = !!e.screenshot_base64;
    const result = await pool.query(
      `UPDATE expenses SET name=$1, category=$2, description=$3, notes=$4, amount=$5, currency=$6, date=$7,
        related_client_id=$8, related_service_id=$9, expense_type=$10, payment_method=$11, updated_at=now(),
        screenshot_data = CASE WHEN $12 THEN $13 ELSE screenshot_data END,
        screenshot_mime = CASE WHEN $12 THEN $14 ELSE screenshot_mime END
       WHERE id=$15 AND agency_id=$16 RETURNING ${RETURNING}`,
      [
        e.name || null, e.category, e.description || null, e.notes || null,
        e.amount || 0, e.currency || "EGP", e.date,
        e.related_client_id || null, e.related_service_id || null,
        newType, e.payment_method || null,
        setScreenshot, buffer, mime, req.params.id, req.user.agencyId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Expense not found" });
    audit(req, { action: "expense.update", entity: "expense", entityId: req.params.id, before, after: result.rows[0], summary: result.rows[0].name || result.rows[0].category });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating expense" });
  }
});

// DELETE /api/expenses/:id
router.delete("/:id", async (req, res) => {
  const before = await fetchBefore("expenses", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Expense not found" });
  if (!can(req.user, moduleFor(before.expense_type), "delete")) return deny(res);
  await pool.query("DELETE FROM expenses WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  audit(req, { action: "expense.delete", entity: "expense", entityId: req.params.id, before, summary: before.name || before.category });
  res.status(204).send();
});

module.exports = router;
