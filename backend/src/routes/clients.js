const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { audit, fetchBefore } = require("../lib/audit");
const events = require("../lib/events");

const router = express.Router();
router.use(requireAuth);

// Keeps the filterable `status` (Active/Suspended/Stopped/Expired) column in
// sync with `contract_status` (active/paused/ended) + contract_end every time
// a client is saved — same mapping used in the one-time Phase 4 backfill.
function deriveStatus(contractStatus, contractEnd) {
  const today = new Date().toISOString().slice(0, 10);
  const endDate = contractEnd ? String(contractEnd).slice(0, 10) : null;

  if (contractStatus === "paused") return "Suspended";
  if (contractStatus === "ended") return "Stopped";
  if (contractStatus === "active") {
    if (endDate && endDate < today) return "Expired";
    return "Active";
  }
  return "Active";
}

// GET /api/clients
// Optional query params (Global Filter System): client_status, service_id, client_id
router.get("/", requirePermission("clients", "view"), async (req, res) => {
  const { client_status, service_id, client_id } = req.query;
  const conditions = ["agency_id = $1"];
  const params = [req.user.agencyId];

  if (client_status && client_status !== "all") {
    params.push(client_status);
    conditions.push(`status = $${params.length}`);
  }
  if (service_id && service_id !== "all") {
    params.push(service_id);
    conditions.push(`id IN (SELECT cs.client_id FROM client_services cs JOIN services sv ON sv.id = cs.service_id WHERE cs.service_id = $${params.length} AND sv.agency_id = $1)`);
  }
  if (client_id && client_id !== "all") {
    params.push(client_id);
    conditions.push(`id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM clients ${where} ORDER BY created_at DESC`, params);
  res.json(result.rows);
});

// GET /api/clients/:id
router.get("/:id", requirePermission("clients", "view"), async (req, res) => {
  const result = await pool.query("SELECT * FROM clients WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  if (!result.rows[0]) return res.status(404).json({ error: "Client not found" });
  res.json(result.rows[0]);
});

// POST /api/clients
router.post("/", requirePermission("clients", "create"), async (req, res) => {
  const c = req.body;
  const contractStatus = c.contract_status || "active";
  const status = deriveStatus(contractStatus, c.contract_end);
  try {
    const result = await pool.query(
      `INSERT INTO clients
        (name, industry, country, contact_name, contact_phone, contact_email,
         contract_start, contract_end, contract_value, currency, contract_status,
         renewal_cycle, notes, status, created_by, agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        c.name, c.industry, c.country, c.contact_name, c.contact_phone, c.contact_email,
        c.contract_start || null, c.contract_end || null, c.contract_value || 0,
        c.currency || "EGP", contractStatus, c.renewal_cycle || "monthly",
        c.notes, status, req.user.id, req.user.agencyId,
      ]
    );
    audit(req, { action: "client.create", entity: "client", entityId: result.rows[0].id, after: result.rows[0], summary: result.rows[0].name });
    events.clientCreated(req, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating client" });
  }
});

// PUT /api/clients/:id
router.put("/:id", requirePermission("clients", "edit"), async (req, res) => {
  const c = req.body;
  const contractStatus = c.contract_status || "active";
  const status = deriveStatus(contractStatus, c.contract_end);
  try {
    const before = await fetchBefore("clients", req.params.id, req.user.agencyId);
    const result = await pool.query(
      `UPDATE clients SET
        name=$1, industry=$2, country=$3, contact_name=$4, contact_phone=$5, contact_email=$6,
        contract_start=$7, contract_end=$8, contract_value=$9, currency=$10, contract_status=$11,
        renewal_cycle=$12, notes=$13, status=$14, updated_at=now()
       WHERE id=$15 AND agency_id=$16 RETURNING *`,
      [
        c.name, c.industry, c.country, c.contact_name, c.contact_phone, c.contact_email,
        c.contract_start || null, c.contract_end || null, c.contract_value || 0,
        c.currency || "EGP", contractStatus, c.renewal_cycle || "monthly",
        c.notes, status, req.params.id, req.user.agencyId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Client not found" });
    audit(req, { action: "client.update", entity: "client", entityId: req.params.id, before, after: result.rows[0], summary: result.rows[0].name });
    events.clientUpdated(req, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating client" });
  }
});

// DELETE /api/clients/:id
router.delete("/:id", requirePermission("clients", "delete"), async (req, res) => {
  const before = await fetchBefore("clients", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Client not found" });
  await pool.query("DELETE FROM clients WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  audit(req, { action: "client.delete", entity: "client", entityId: req.params.id, before, summary: before.name });
  res.status(204).send();
});

module.exports = router;
