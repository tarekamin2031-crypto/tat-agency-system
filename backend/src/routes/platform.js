const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const { requireAuth, requirePlatformAdmin } = require("../middleware/auth");
const { seedAgencyDefaults } = require("../lib/agencySeed");
const { queryLogs, logFilterOptions } = require("../lib/logQuery");
const { validateEmail } = require("../lib/settingsValidation");
const { audit } = require("../lib/audit");
const { getEmailSettings, saveEmailSettings } = require("../lib/emailSettings");
const { sendEmail } = require("../lib/mailer");

// Platform (Super Admin) panel: manage every agency on the system.
const router = express.Router();
router.use(requireAuth, requirePlatformAdmin);

const MIN_PASSWORD_LENGTH = 8;
const LANGS = ["ar", "en"];

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const AGENCY_LIST_SQL = `
  SELECT a.id, a.name, a.slug, a.is_active, a.max_users, a.default_language, a.created_at,
         (SELECT COUNT(*)::int FROM users u WHERE u.agency_id = a.id) AS user_count,
         (SELECT COUNT(*)::int FROM users u WHERE u.agency_id = a.id AND u.is_active) AS active_user_count,
         (SELECT COUNT(*)::int FROM clients c WHERE c.agency_id = a.id) AS client_count,
         (SELECT COUNT(*)::int FROM invoices i WHERE i.agency_id = a.id) AS invoice_count,
         (SELECT MAX(l.created_at) FROM audit_logs l WHERE l.agency_id = a.id) AS last_activity_at,
         (SELECT u.email FROM users u JOIN roles r ON r.id = u.role_id
            WHERE u.agency_id = a.id AND r.key = 'agency_admin' ORDER BY u.id LIMIT 1) AS admin_email
    FROM agencies a`;

// GET /api/platform/agencies
router.get("/agencies", async (req, res) => {
  const { rows } = await pool.query(`${AGENCY_LIST_SQL} ORDER BY a.id`);
  res.json(rows);
});

// POST /api/platform/agencies — create an agency together with its first admin.
// Body: { name, slug?, max_users?, default_language?, admin: { name, email, password } }
router.post("/agencies", async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 200);
  const admin = req.body.admin || {};
  if (!name) return res.status(400).json({ error: "اسم الوكالة مطلوب" });
  if (!admin.name || !admin.email || !admin.password) return res.status(400).json({ error: "بيانات مدير الوكالة مطلوبة (الاسم والإيميل وكلمة المرور)" });
  if (!validateEmail(String(admin.email).trim())) return res.status(400).json({ error: "إيميل المدير غير صالح" });
  if (String(admin.password).length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} حروف على الأقل` });

  const maxUsers = Math.min(Math.max(parseInt(req.body.max_users, 10) || 10, 1), 10000);
  const language = LANGS.includes(req.body.default_language) ? req.body.default_language : "ar";
  const slug = slugify(req.body.slug || name) || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ag = await client.query(
      "INSERT INTO agencies (name, slug, max_users, default_language) VALUES ($1,$2,$3,$4) RETURNING id",
      [name, slug, maxUsers, language]
    );
    const agencyId = ag.rows[0].id;
    const roleIds = await seedAgencyDefaults(client, agencyId, { name });
    const hash = await bcrypt.hash(String(admin.password), 10);
    const u = await client.query(
      "INSERT INTO users (name, email, password_hash, role, role_id, agency_id) VALUES ($1,$2,$3,'admin',$4,$5) RETURNING id",
      [String(admin.name).trim(), String(admin.email).trim(), hash, roleIds.agency_admin, agencyId]
    );
    await client.query("COMMIT");

    audit(req, { action: "agency.create", entity: "agency", entityId: agencyId, agencyId, after: { name, slug, max_users: maxUsers, default_language: language, admin_email: String(admin.email).trim() }, summary: name });
    const created = (await pool.query(`${AGENCY_LIST_SQL} WHERE a.id = $1`, [agencyId])).rows[0];
    res.status(201).json({ ...created, admin_user_id: u.rows[0].id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      const dupUser = /email/i.test(err.constraint || err.detail || "");
      return res.status(409).json({ error: dupUser ? "إيميل المدير مستخدم قبل كده" : "الاسم المختصر (slug) مستخدم قبل كده" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error creating agency" });
  } finally {
    client.release();
  }
});

// PATCH /api/platform/agencies/:id — rename / enable-disable / user limit / default language
router.patch("/agencies/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid agency id" });
  const cur = (await pool.query("SELECT * FROM agencies WHERE id = $1", [id])).rows[0];
  if (!cur) return res.status(404).json({ error: "Agency not found" });

  const sets = [];
  const vals = [];
  const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (req.body.name !== undefined) {
    const n = String(req.body.name).trim().slice(0, 200);
    if (!n) return res.status(400).json({ error: "اسم الوكالة مطلوب" });
    add("name", n);
  }
  if (req.body.is_active !== undefined) {
    // The platform owner's own agency can't be switched off from under them.
    if (req.body.is_active === false && id === req.user.agencyId) return res.status(400).json({ error: "مينفعش توقف الوكالة اللي أنت فيها" });
    add("is_active", Boolean(req.body.is_active));
  }
  if (req.body.max_users !== undefined) {
    const m = parseInt(req.body.max_users, 10);
    if (!Number.isInteger(m) || m < 1 || m > 10000) return res.status(400).json({ error: "الحد الأقصى للمستخدمين غير صالح" });
    add("max_users", m);
  }
  if (req.body.default_language !== undefined) {
    if (!LANGS.includes(req.body.default_language)) return res.status(400).json({ error: "اللغة غير مدعومة" });
    add("default_language", req.body.default_language);
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });

  vals.push(id);
  await pool.query(`UPDATE agencies SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  const updated = (await pool.query(`${AGENCY_LIST_SQL} WHERE a.id = $1`, [id])).rows[0];

  const snap = (a) => ({ name: a.name, is_active: a.is_active, max_users: a.max_users, default_language: a.default_language });
  const action = req.body.is_active !== undefined && req.body.is_active !== cur.is_active
    ? (req.body.is_active ? "agency.enable" : "agency.disable")
    : "agency.update";
  audit(req, { action, entity: "agency", entityId: id, agencyId: id, before: snap(cur), after: snap(updated), summary: updated.name });
  res.json(updated);
});

// GET /api/platform/logs — every agency (optionally filtered by agency_id)
router.get("/logs", async (req, res) => {
  const { page, limit, ...filters } = req.query;
  try {
    res.json(await queryLogs({ agencyId: null, filters, page, limit }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error loading logs" });
  }
});

router.get("/logs/filters", async (req, res) => {
  try {
    res.json(await logFilterOptions({ agencyId: null }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error loading log filters" });
  }
});

// ---- Leads: contact / demo requests from the public landing page ----
router.get("/leads", async (req, res) => {
  const status = ["new", "contacted", "closed"].includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, company, team_size, interest, message, lang, status, notes, created_at, updated_at
       FROM leads WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 300`, [status]);
  const counts = (await pool.query("SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status")).rows;
  res.json({ leads: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
});

router.patch("/leads/:id", async (req, res) => {
  const sets = []; const vals = [];
  if (req.body.status !== undefined) {
    if (!["new", "contacted", "closed"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
    vals.push(req.body.status); sets.push(`status = $${vals.length}`);
  }
  if (req.body.notes !== undefined) { vals.push(String(req.body.notes).slice(0, 2000) || null); sets.push(`notes = $${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  vals.push(Number(req.params.id));
  const r = await pool.query(`UPDATE leads SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
  if (!r.rows[0]) return res.status(404).json({ error: "Lead not found" });
  audit(req, { action: "lead.update", entity: "lead", entityId: r.rows[0].id, agencyId: null, summary: `${r.rows[0].name}: ${r.rows[0].status}` });
  res.json(r.rows[0]);
});

router.delete("/leads/:id", async (req, res) => {
  const r = await pool.query("DELETE FROM leads WHERE id = $1 RETURNING name", [Number(req.params.id)]);
  if (!r.rows[0]) return res.status(404).json({ error: "Lead not found" });
  audit(req, { action: "lead.delete", entity: "lead", entityId: req.params.id, agencyId: null, summary: r.rows[0].name });
  res.status(204).send();
});

// Platform-wide SMTP (used by every agency that has no SMTP of its own)
router.get("/email", async (req, res) => {
  res.json({ settings: await getEmailSettings(null), env_fallback: !!process.env.SMTP_HOST });
});

router.put("/email", async (req, res) => {
  const { settings, error } = await saveEmailSettings(null, req.body);
  if (error) return res.status(400).json({ error });
  audit(req, { action: "platform.email_update", entity: "email_settings", agencyId: null, summary: settings.enabled ? `${settings.host}:${settings.port}` : "disabled" });
  res.json({ settings });
});

router.post("/email/test", async (req, res) => {
  const to = String(req.body.to || req.user.email).trim();
  const r = await sendEmail({ agencyId: null, to, template: "test", lang: req.body.lang === "en" ? "en" : "ar", brand: "TAT Platform", wait: true });
  if (!r.ok) return res.status(400).json({ error: r.error === "no_smtp" ? "مفيش إعدادات SMTP مفعّلة" : `فشل الإرسال: ${r.error}` });
  res.json({ ok: true, to });
});

module.exports = router;
