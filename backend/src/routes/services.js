const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { audit, fetchBefore } = require("../lib/audit");
const { ownsRow } = require("../lib/tenant");

const router = express.Router();
router.use(requireAuth);

// GET /api/services
router.get("/", requirePermission("services", "view"), async (req, res) => {
  const result = await pool.query("SELECT * FROM services WHERE agency_id = $1 ORDER BY name ASC", [req.user.agencyId]);
  res.json(result.rows);
});

// POST /api/services
router.post("/", requirePermission("services", "create"), async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  try {
    const result = await pool.query(
      "INSERT INTO services (agency_id, name, description) VALUES ($1, $2, $3) RETURNING *",
      [req.user.agencyId, name.trim(), description || null]
    );
    audit(req, { action: "service.create", entity: "service", entityId: result.rows[0].id, after: result.rows[0], summary: name.trim() });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "A service with this name already exists" });
    console.error(err);
    res.status(500).json({ error: "Server error creating service" });
  }
});

// PUT /api/services/:id
router.put("/:id", requirePermission("services", "edit"), async (req, res) => {
  const { name, description } = req.body;
  try {
    const before = await fetchBefore("services", req.params.id, req.user.agencyId);
    const result = await pool.query(
      "UPDATE services SET name = $1, description = $2 WHERE id = $3 AND agency_id = $4 RETURNING *",
      [name, description || null, req.params.id, req.user.agencyId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Service not found" });
    audit(req, { action: "service.update", entity: "service", entityId: req.params.id, before, after: result.rows[0], summary: result.rows[0].name });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "A service with this name already exists" });
    console.error(err);
    res.status(500).json({ error: "Server error updating service" });
  }
});

// DELETE /api/services/:id
router.delete("/:id", requirePermission("services", "delete"), async (req, res) => {
  const before = await fetchBefore("services", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Service not found" });
  await pool.query("DELETE FROM services WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  audit(req, { action: "service.delete", entity: "service", entityId: req.params.id, before, summary: before.name });
  res.status(204).send();
});

const clientServicesQuery = `SELECT s.* FROM client_services cs
  JOIN services s ON s.id = cs.service_id
  WHERE cs.client_id = $1 AND s.agency_id = $2 ORDER BY s.name ASC`;

// GET /api/services/client/:clientId — services assigned to a client
router.get("/client/:clientId", requirePermission("services", "view"), async (req, res) => {
  if (!(await ownsRow("clients", req.params.clientId, req.user.agencyId))) return res.status(404).json({ error: "Client not found" });
  const result = await pool.query(clientServicesQuery, [req.params.clientId, req.user.agencyId]);
  res.json(result.rows);
});

// PUT /api/services/client/:clientId — replace the full set of services for a client
router.put("/client/:clientId", requirePermission("clients", "edit"), async (req, res) => {
  const { service_ids } = req.body; // array of service ids
  const clientId = req.params.clientId;
  const agencyId = req.user.agencyId;
  try {
    if (!(await ownsRow("clients", clientId, agencyId))) return res.status(404).json({ error: "Client not found" });
    const before = (await pool.query(clientServicesQuery, [clientId, agencyId])).rows.map((s) => s.id);

    await pool.query("DELETE FROM client_services WHERE client_id = $1", [clientId]);
    if (Array.isArray(service_ids) && service_ids.length > 0) {
      // only services of this agency can be attached
      const valid = (await pool.query("SELECT id FROM services WHERE id = ANY($1::int[]) AND agency_id = $2", [service_ids.map(Number).filter(Number.isInteger), agencyId])).rows.map((r) => r.id);
      if (valid.length) {
        const values = valid.map((_, i) => `($1, $${i + 2})`).join(",");
        await pool.query(`INSERT INTO client_services (client_id, service_id) VALUES ${values} ON CONFLICT DO NOTHING`, [clientId, ...valid]);
      }
    }
    const result = await pool.query(clientServicesQuery, [clientId, agencyId]);
    audit(req, { action: "client.services_update", entity: "client", entityId: clientId, before: { service_ids: before }, after: { service_ids: result.rows.map((s) => s.id) } });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating client services" });
  }
});

module.exports = router;
