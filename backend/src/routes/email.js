const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { getEmailSettings, saveEmailSettings } = require("../lib/emailSettings");
const { sendEmail, resolveSmtp } = require("../lib/mailer");
const { getCompany } = require("../lib/company");
const { audit } = require("../lib/audit");
const { createRateLimiter } = require("../middleware/security");

const router = express.Router();
router.use(requireAuth);
const testLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

const userLang = (req) => (req.query.lang === "en" || req.body?.lang === "en" ? "en" : req.user.agencyLanguage === "en" ? "en" : "ar");

// GET /api/email/settings — this agency's SMTP override + whether a platform default exists
router.get("/settings", requirePermission("settings", "view"), async (req, res) => {
  const [settings, platform] = await Promise.all([getEmailSettings(req.user.agencyId), resolveSmtp(null)]);
  res.json({ settings, platform_available: !!platform });
});

// PUT /api/email/settings
router.put("/settings", requirePermission("settings", "edit"), async (req, res) => {
  const { settings, error } = await saveEmailSettings(req.user.agencyId, req.body);
  if (error) return res.status(400).json({ error });
  audit(req, { action: "settings.email_update", entity: "email_settings", summary: settings.enabled ? `${settings.host}:${settings.port}` : "disabled", after: { enabled: settings.enabled, host: settings.host, port: settings.port, from_email: settings.from_email, notify_payment: settings.notify_payment, notify_overdue: settings.notify_overdue } });
  res.json({ settings });
});

// DELETE /api/email/settings — go back to the platform default
router.delete("/settings", requirePermission("settings", "edit"), async (req, res) => {
  await pool.query("DELETE FROM email_settings WHERE agency_id = $1", [req.user.agencyId]);
  audit(req, { action: "settings.email_update", entity: "email_settings", summary: "reset to platform default" });
  res.status(204).send();
});

// POST /api/email/test { to? } — sends a real test message and reports the result
router.post("/test", requirePermission("settings", "edit"), testLimiter, async (req, res) => {
  const to = String(req.body.to || req.user.email).trim();
  const company = await getCompany(req.user.agencyId);
  const r = await sendEmail({ agencyId: req.user.agencyId, to, template: "test", lang: userLang(req), brand: company.name, wait: true });
  audit(req, { action: "settings.email_test", entity: "email_settings", summary: `${to}: ${r.ok ? "sent" : r.error}` });
  if (!r.ok) {
    const msg = r.error === "no_smtp" ? "مفيش إعدادات SMTP مفعّلة (لا للوكالة ولا للمنصة)" : r.error === "invalid_recipient" ? "الإيميل غير صالح" : `فشل الإرسال: ${r.error}`;
    return res.status(400).json({ error: msg });
  }
  res.json({ ok: true, to });
});

// GET /api/email/log — recent messages of this agency
router.get("/log", requirePermission("settings", "view"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, to_email, subject, template, status, attempts, error, created_at, sent_at
       FROM email_log WHERE agency_id = $1 ORDER BY id DESC LIMIT 50`,
    [req.user.agencyId]
  );
  res.json(rows);
});

module.exports = router;
