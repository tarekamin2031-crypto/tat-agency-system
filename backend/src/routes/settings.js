const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { sanitizeCompany, parseImageUpload } = require("../lib/settingsValidation");
const { getCompany } = require("../lib/company");
const { audit } = require("../lib/audit");

const router = express.Router();
router.use(requireAuth);

const LOGO_MAX_BYTES = 1024 * 1024;

// GET /api/settings/company — readable by every signed-in user (shown in the app shell)
router.get("/company", async (req, res) => {
  res.json(await getCompany(req.user.agencyId));
});

// PUT /api/settings/company — needs settings.edit
router.put("/company", requirePermission("settings", "edit"), async (req, res) => {
  const { values, error } = sanitizeCompany(req.body);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(values);
  if (!keys.length) return res.status(400).json({ error: "مفيش حاجة تتعدّل" });
  const before = await getCompany(req.user.agencyId);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  await pool.query(
    `UPDATE company_settings SET ${sets.join(", ")}, updated_at = now() WHERE agency_id = $${keys.length + 1}`,
    [...keys.map((k) => values[k]), req.user.agencyId]
  );
  const after = await getCompany(req.user.agencyId);
  audit(req, { action: "settings.update", entity: "company_settings", before, after, summary: keys.join(", ") });
  res.json(after);
});

// Logo: stored in the DB (captured by the regular backup), managed with settings.edit.
router.post("/company/logo", requirePermission("settings", "edit"), async (req, res) => {
  const parsed = parseImageUpload(req.body && req.body.data, LOGO_MAX_BYTES);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  await pool.query("UPDATE company_settings SET logo_data = $1, logo_mime = $2, updated_at = now() WHERE agency_id = $3", [parsed.buffer, parsed.mime, req.user.agencyId]);
  audit(req, { action: "settings.logo_update", entity: "company_settings", summary: "logo" });
  res.json(await getCompany(req.user.agencyId));
});

router.delete("/company/logo", requirePermission("settings", "edit"), async (req, res) => {
  await pool.query("UPDATE company_settings SET logo_data = NULL, logo_mime = NULL, updated_at = now() WHERE agency_id = $1", [req.user.agencyId]);
  audit(req, { action: "settings.logo_delete", entity: "company_settings", summary: "logo" });
  res.status(204).send();
});

router.get("/company/logo", async (req, res) => {
  const { rows } = await pool.query("SELECT logo_data, logo_mime FROM company_settings WHERE agency_id = $1", [req.user.agencyId]);
  if (!rows[0] || !rows[0].logo_data) return res.status(404).json({ error: "No custom logo" });
  res.set("Content-Type", rows[0].logo_mime || "image/png");
  res.set("Cache-Control", "private, max-age=60");
  res.send(rows[0].logo_data);
});

module.exports = router;
