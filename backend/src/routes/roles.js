const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireAdmin, requirePermission } = require("../middleware/auth");
const { MODULES, ACTIONS, sanitizePermissions } = require("../lib/permissions");
const { audit } = require("../lib/audit");

const router = express.Router();
router.use(requireAuth);

const clip = (v, n) => String(v || "").trim().slice(0, n);

// GET /api/roles — roles of the agency with how many users hold each one.
router.get("/", requirePermission("team", "view"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.key, r.name, r.description, r.is_system, r.permissions, r.created_at,
            (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r WHERE r.agency_id = $1
      ORDER BY r.is_system DESC, r.id ASC`,
    [req.user.agencyId]
  );
  res.json({ roles: rows, modules: MODULES, actions: ACTIONS });
});

// POST /api/roles — custom role (agency admin only: a role editor could otherwise grant themselves anything)
router.post("/", requireAdmin, async (req, res) => {
  const name = clip(req.body.name, 100);
  if (!name) return res.status(400).json({ error: "اسم الدور مطلوب" });
  const permissions = sanitizePermissions(req.body.permissions);
  try {
    const key = `custom_${Date.now().toString(36)}`;
    const { rows } = await pool.query(
      `INSERT INTO roles (agency_id, key, name, description, is_system, permissions)
       VALUES ($1,$2,$3,$4,false,$5::jsonb) RETURNING id, key, name, description, is_system, permissions, created_at`,
      [req.user.agencyId, key, name, clip(req.body.description, 300) || null, JSON.stringify(permissions)]
    );
    audit(req, { action: "role.create", entity: "role", entityId: rows[0].id, after: { name, permissions }, summary: name });
    res.status(201).json({ ...rows[0], user_count: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating role" });
  }
});

// PUT /api/roles/:id — rename / change the permission matrix. The admin role is locked.
router.put("/:id", requireAdmin, async (req, res) => {
  const cur = await pool.query("SELECT * FROM roles WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  const role = cur.rows[0];
  if (!role) return res.status(404).json({ error: "Role not found" });
  if (role.key === "agency_admin") return res.status(400).json({ error: "دور مدير الوكالة ثابت ومينفعش يتعدّل" });

  const name = req.body.name !== undefined ? clip(req.body.name, 100) : role.name;
  if (!name) return res.status(400).json({ error: "اسم الدور مطلوب" });
  const description = req.body.description !== undefined ? clip(req.body.description, 300) || null : role.description;
  const permissions = req.body.permissions !== undefined ? sanitizePermissions(req.body.permissions) : role.permissions;

  const { rows } = await pool.query(
    `UPDATE roles SET name = $1, description = $2, permissions = $3::jsonb WHERE id = $4 AND agency_id = $5
     RETURNING id, key, name, description, is_system, permissions, created_at`,
    [name, description, JSON.stringify(permissions), role.id, req.user.agencyId]
  );
  audit(req, {
    action: "role.update", entity: "role", entityId: role.id,
    before: { name: role.name, description: role.description, permissions: role.permissions },
    after: { name, description, permissions }, summary: name,
  });
  const count = (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1", [role.id])).rows[0].n;
  res.json({ ...rows[0], user_count: count });
});

// DELETE /api/roles/:id — custom roles only, and only when nobody holds them.
router.delete("/:id", requireAdmin, async (req, res) => {
  const cur = await pool.query("SELECT * FROM roles WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  const role = cur.rows[0];
  if (!role) return res.status(404).json({ error: "Role not found" });
  if (role.is_system) return res.status(400).json({ error: "الأدوار الأساسية مينفعش تتحذف" });
  const count = (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1", [role.id])).rows[0].n;
  if (count > 0) return res.status(409).json({ error: `في ${count} مستخدم على الدور ده. غيّر دورهم الأول.` });
  await pool.query("DELETE FROM roles WHERE id = $1 AND agency_id = $2", [role.id, req.user.agencyId]);
  audit(req, { action: "role.delete", entity: "role", entityId: role.id, before: { name: role.name, permissions: role.permissions }, summary: role.name });
  res.status(204).send();
});

module.exports = router;
