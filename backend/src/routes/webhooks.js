const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission, can } = require("../middleware/auth");
const { EVENTS, newSecret, assertSafeUrl, deliver, maskUrl, buildMessage } = require("../lib/webhooks");
const { audit } = require("../lib/audit");

const router = express.Router();
router.use(requireAuth);

const mask = (s) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const cleanEvents = (v) => {
  const list = Array.isArray(v) ? v : [];
  if (list.includes("*")) return ["*"];
  return [...new Set(list.filter((e) => EVENTS.includes(e)))];
};
// Editors get the full URL (they need it to edit); everybody else never sees a Telegram token.
const present = (row, showSecret) => ({ ...row, secret: showSecret ? row.secret : mask(row.secret), url: showSecret ? row.url : maskUrl(row.url) });

const METHODS = ["POST", "GET"];
const KINDS = ["custom", "telegram"];
const cleanMethod = (v, fallback = "POST") => (METHODS.includes(String(v || "").toUpperCase()) ? String(v).toUpperCase() : fallback);
const cleanKind = (v, fallback = "custom") => (KINDS.includes(v) ? v : fallback);
const cleanTemplate = (v) => { const t = String(v ?? "").trim().slice(0, 500); return t || null; };
// the URL may contain {{placeholders}}; validate it with sample values filled in
const checkUrl = (url) => assertSafeUrl(String(url || "").trim().slice(0, 2000).replace(/\{\{\s*[\w.]+\s*\}\}/g, "x"));

async function ownEndpoint(req) {
  const { rows } = await pool.query("SELECT * FROM webhook_endpoints WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  return rows[0] || null;
}

// GET /api/webhooks/events
router.get("/events", requirePermission("settings", "view"), (req, res) => res.json(EVENTS));

// GET /api/webhooks — endpoints with delivery stats (secret only shown to those who can edit settings)
router.get("/", requirePermission("settings", "view"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*,
            (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.endpoint_id = e.id AND d.status = 'failed') AS failed_count,
            (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.endpoint_id = e.id AND d.status = 'success') AS success_count,
            (SELECT d.status FROM webhook_deliveries d WHERE d.endpoint_id = e.id ORDER BY d.id DESC LIMIT 1) AS last_status,
            (SELECT d.created_at FROM webhook_deliveries d WHERE d.endpoint_id = e.id ORDER BY d.id DESC LIMIT 1) AS last_at
       FROM webhook_endpoints e WHERE e.agency_id = $1 ORDER BY e.id`,
    [req.user.agencyId]
  );
  const edit = can(req.user, "settings", "edit");
  res.json(rows.map((r) => present(r, edit)));
});

// POST /api/webhooks
router.post("/", requirePermission("settings", "edit"), async (req, res) => {
  try {
    await checkUrl(req.body.url);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const events = cleanEvents(req.body.events);
  if (!events.length) return res.status(400).json({ error: "اختار حدث واحد على الأقل" });
  const count = (await pool.query("SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE agency_id = $1", [req.user.agencyId])).rows[0].n;
  if (count >= 20) return res.status(400).json({ error: "وصلت للحد الأقصى لعدد الـ Webhooks (20)" });
  const { rows } = await pool.query(
    "INSERT INTO webhook_endpoints (agency_id, url, description, secret, events, method, message_template, kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [req.user.agencyId, String(req.body.url).trim().slice(0, 2000), String(req.body.description || "").trim().slice(0, 200) || null, newSecret(), events, cleanMethod(req.body.method), cleanTemplate(req.body.message_template), cleanKind(req.body.kind)]);
  audit(req, { action: "webhook.create", entity: "webhook", entityId: rows[0].id, after: { url: maskUrl(rows[0].url), events, method: rows[0].method }, summary: maskUrl(rows[0].url) });
  res.status(201).json(present(rows[0], true));
});

// PUT /api/webhooks/:id
router.put("/:id", requirePermission("settings", "edit"), async (req, res) => {
  const cur = await ownEndpoint(req);
  if (!cur) return res.status(404).json({ error: "Webhook not found" });
  const url = req.body.url !== undefined ? String(req.body.url).trim().slice(0, 2000) : cur.url;
  if (url !== cur.url) { try { await checkUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const events = req.body.events !== undefined ? cleanEvents(req.body.events) : cur.events;
  if (!events.length) return res.status(400).json({ error: "اختار حدث واحد على الأقل" });
  const description = req.body.description !== undefined ? String(req.body.description).trim().slice(0, 200) || null : cur.description;
  const active = req.body.is_active !== undefined ? !!req.body.is_active : cur.is_active;
  const method = req.body.method !== undefined ? cleanMethod(req.body.method, cur.method) : cur.method;
  const template = req.body.message_template !== undefined ? cleanTemplate(req.body.message_template) : cur.message_template;
  const kind = req.body.kind !== undefined ? cleanKind(req.body.kind, cur.kind) : cur.kind;
  const { rows } = await pool.query(
    "UPDATE webhook_endpoints SET url=$1, description=$2, events=$3, is_active=$4, method=$7, message_template=$8, kind=$9 WHERE id=$5 AND agency_id=$6 RETURNING *",
    [url, description, events, active, cur.id, req.user.agencyId, method, template, kind]);
  audit(req, { action: "webhook.update", entity: "webhook", entityId: cur.id,
    before: { url: maskUrl(cur.url), events: cur.events, is_active: cur.is_active, description: cur.description, method: cur.method },
    after: { url: maskUrl(url), events, is_active: active, description, method }, summary: maskUrl(url) });
  res.json(present(rows[0], true));
});

// POST /api/webhooks/:id/rotate — new signing secret
router.post("/:id/rotate", requirePermission("settings", "edit"), async (req, res) => {
  const cur = await ownEndpoint(req);
  if (!cur) return res.status(404).json({ error: "Webhook not found" });
  const { rows } = await pool.query("UPDATE webhook_endpoints SET secret = $1 WHERE id = $2 AND agency_id = $3 RETURNING *", [newSecret(), cur.id, req.user.agencyId]);
  audit(req, { action: "webhook.rotate", entity: "webhook", entityId: cur.id, summary: maskUrl(cur.url) });
  res.json(present(rows[0], true));
});

// DELETE /api/webhooks/:id
router.delete("/:id", requirePermission("settings", "edit"), async (req, res) => {
  const cur = await ownEndpoint(req);
  if (!cur) return res.status(404).json({ error: "Webhook not found" });
  await pool.query("DELETE FROM webhook_endpoints WHERE id = $1 AND agency_id = $2", [cur.id, req.user.agencyId]);
  audit(req, { action: "webhook.delete", entity: "webhook", entityId: cur.id, before: { url: maskUrl(cur.url), events: cur.events }, summary: maskUrl(cur.url) });
  res.status(204).send();
});

// POST /api/webhooks/:id/test — sends a signed "webhook.test" event right now and returns the result
router.post("/:id/test", requirePermission("settings", "edit"), async (req, res) => {
  const cur = await ownEndpoint(req);
  if (!cur) return res.status(404).json({ error: "Webhook not found" });
  const ins = await pool.query(
    "INSERT INTO webhook_deliveries (endpoint_id, agency_id, event, payload, attempts) VALUES ($1,$2,'webhook.test',$3::jsonb, 0) RETURNING id",
    [cur.id, req.user.agencyId, JSON.stringify({ message: "Test event from TAT", number: "TEST-001", client_name: "Test client", amount: 100, currency: "EGP", sent_by: req.user.email })]);
  const result = await deliver(ins.rows[0].id);
  audit(req, { action: "webhook.test", entity: "webhook", entityId: cur.id, summary: `${maskUrl(cur.url)}: ${result.status}` });
  res.json(result);
});

// GET /api/webhooks/:id/deliveries
router.get("/:id/deliveries", requirePermission("settings", "view"), async (req, res) => {
  const cur = await ownEndpoint(req);
  if (!cur) return res.status(404).json({ error: "Webhook not found" });
  const { rows } = await pool.query(
    `SELECT id, event, status, attempts, response_status, response_body, error, next_attempt_at, created_at, delivered_at
       FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY id DESC LIMIT 50`, [cur.id]);
  res.json(rows);
});

// POST /api/webhooks/deliveries/:deliveryId/redeliver
router.post("/deliveries/:deliveryId/redeliver", requirePermission("settings", "edit"), async (req, res) => {
  const { rows } = await pool.query("SELECT id FROM webhook_deliveries WHERE id = $1 AND agency_id = $2", [req.params.deliveryId, req.user.agencyId]);
  if (!rows[0]) return res.status(404).json({ error: "Delivery not found" });
  await pool.query("UPDATE webhook_deliveries SET status='pending', attempts=0, error=NULL WHERE id = $1", [rows[0].id]);
  res.json(await deliver(rows[0].id));
});

module.exports = router;
