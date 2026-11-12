const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { audit, fetchBefore } = require("../lib/audit");
const { ownsRow } = require("../lib/tenant");
const { generateTasksForMonth, seedDefaultTemplates, monthOf, MONTH_RE } = require("../jobs/monthlyTasks");

const router = express.Router();
router.use(requireAuth);

const STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["normal", "high", "urgent"];

const text = (v, max) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const intOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);
const dateOrNull = (v) => (v === undefined || v === null || v === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : NaN);

// Links: an array of http(s) URLs (max 10).
function cleanLinks(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => /^https?:\/\/\S+$/i.test(x)).slice(0, 10).map((x) => x.slice(0, 500));
}

const TASK_SELECT = `SELECT t.*, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, c.name AS client_name, u.name AS assignee_name
  FROM tasks t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.assignee_id`;

// GET /api/tasks/assignees — team members that can be assigned (no "team" permission needed)
router.get("/assignees", requirePermission("tasks", "view"), async (req, res) => {
  const { rows } = await pool.query("SELECT id, name FROM users WHERE agency_id = $1 AND is_active IS NOT FALSE ORDER BY name", [req.user.agencyId]);
  res.json(rows);
});

// GET /api/tasks/clients — the agency's clients with their tasks on/off switch
router.get("/clients", requirePermission("tasks", "view"), async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, contract_status, tasks_enabled FROM clients WHERE agency_id = $1 ORDER BY name", [req.user.agencyId]);
  res.json(rows);
});

// PUT /api/tasks/clients/:id { enabled } — pause/resume a client's tasks (nothing is deleted; generation skips paused clients)
router.put("/clients/:id", requirePermission("tasks", "edit"), async (req, res) => {
  const agencyId = req.user.agencyId;
  if (!(await ownsRow("clients", req.params.id, agencyId))) return res.status(404).json({ error: "Client not found" });
  const enabled = !!(req.body && req.body.enabled);
  const { rows } = await pool.query("UPDATE clients SET tasks_enabled = $1 WHERE id = $2 AND agency_id = $3 RETURNING id, name, tasks_enabled", [enabled, req.params.id, agencyId]);
  audit(req, { action: "client.tasks_toggle", entity: "client", entityId: rows[0].id, after: { tasks_enabled: enabled }, summary: rows[0].name });
  res.json(rows[0]);
});

// DELETE /api/tasks/clients/:id?month=YYYY-MM — remove a client from the tasks system: pause it, delete its templates
// and its tasks of that month (other months are kept as history).
router.delete("/clients/:id", requirePermission("tasks", "delete"), async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    if (!(await ownsRow("clients", req.params.id, agencyId))) return res.status(404).json({ error: "Client not found" });
    const month = MONTH_RE.test(String(req.query.month || "")) ? req.query.month : monthOf();
    const client = (await pool.query("UPDATE clients SET tasks_enabled = false WHERE id = $1 AND agency_id = $2 RETURNING id, name", [req.params.id, agencyId])).rows[0];
    const tpl = await pool.query("DELETE FROM task_templates WHERE client_id = $1 AND agency_id = $2", [client.id, agencyId]);
    const tsk = await pool.query("DELETE FROM tasks WHERE client_id = $1 AND agency_id = $2 AND month = $3", [client.id, agencyId, month]);
    audit(req, { action: "client.tasks_remove", entity: "client", entityId: client.id, after: { month, templates: tpl.rowCount, tasks: tsk.rowCount }, summary: client.name });
    res.json({ templates: tpl.rowCount, tasks: tsk.rowCount, month });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error removing client tasks" });
  }
});

// GET /api/tasks?month=YYYY-MM[&client_id=][&assignee_id=]
router.get("/", requirePermission("tasks", "view"), async (req, res) => {
  const month = MONTH_RE.test(String(req.query.month || "")) ? req.query.month : monthOf();
  const params = [req.user.agencyId, month];
  let where = "t.agency_id = $1 AND t.month = $2";
  if (req.query.client_id) { params.push(Number(req.query.client_id) || 0); where += ` AND t.client_id = $${params.length}`; }
  if (req.query.assignee_id) { params.push(Number(req.query.assignee_id) || 0); where += ` AND t.assignee_id = $${params.length}`; }
  const { rows } = await pool.query(`${TASK_SELECT} WHERE ${where} ORDER BY c.name, (t.status = 'done'), t.due_date NULLS LAST, t.id`, params);
  res.json(rows);
});

// Validates + normalises a task body. Returns { error } or { value }.
async function parseTask(body, agencyId, { partial } = {}) {
  const v = {};
  if (!partial || body.title !== undefined) {
    v.title = text(body.title, 200);
    if (!v.title) return { error: "title is required" };
  }
  if (body.description !== undefined) v.description = text(body.description, 4000);
  if (body.notes !== undefined) v.notes = text(body.notes, 4000);
  if (body.status !== undefined) { if (!STATUSES.includes(body.status)) return { error: "invalid status" }; v.status = body.status; }
  if (body.priority !== undefined) { if (!PRIORITIES.includes(body.priority)) return { error: "invalid priority" }; v.priority = body.priority; }
  if (body.due_date !== undefined) { v.due_date = dateOrNull(body.due_date); if (Number.isNaN(v.due_date)) return { error: "invalid due_date" }; }
  if (body.assignee_id !== undefined) {
    v.assignee_id = intOrNull(body.assignee_id);
    if (Number.isNaN(v.assignee_id)) return { error: "invalid assignee" };
    if (!(await ownsRow("users", v.assignee_id, agencyId))) return { error: "assignee not found" };
  }
  const links = cleanLinks(body.links);
  if (links !== undefined) v.links = JSON.stringify(links);
  return { value: v };
}

// POST /api/tasks
router.post("/", requirePermission("tasks", "create"), async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const clientId = intOrNull(req.body.client_id);
    if (!clientId || Number.isNaN(clientId) || !(await ownsRow("clients", clientId, agencyId))) return res.status(400).json({ error: "client is required" });
    const month = MONTH_RE.test(String(req.body.month || "")) ? req.body.month : monthOf();
    const { error, value: v } = await parseTask(req.body, agencyId);
    if (error) return res.status(400).json({ error });
    const done = v.status === "done";
    const { rows } = await pool.query(
      `INSERT INTO tasks (agency_id, client_id, month, title, description, status, priority, assignee_id, due_date, notes, links, completed_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING id`,
      [agencyId, clientId, month, v.title, v.description ?? null, v.status || "todo", v.priority || "normal", v.assignee_id ?? null,
       v.due_date ?? null, v.notes ?? null, v.links || "[]", done ? new Date() : null, req.user.id]
    );
    const task = (await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [rows[0].id])).rows[0];
    audit(req, { action: "task.create", entity: "task", entityId: task.id, after: task, summary: `${task.client_name}: ${task.title}` });
    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating task" });
  }
});

// PUT /api/tasks/:id (partial update — also used for drag & drop status changes)
router.put("/:id", requirePermission("tasks", "edit"), async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const before = await fetchBefore("tasks", req.params.id, agencyId);
    if (!before) return res.status(404).json({ error: "Task not found" });
    const { error, value: v } = await parseTask(req.body, agencyId, { partial: true });
    if (error) return res.status(400).json({ error });
    const sets = [];
    const params = [];
    for (const [k, val] of Object.entries(v)) {
      params.push(val);
      sets.push(`${k} = $${params.length}${k === "links" ? "::jsonb" : ""}`);
    }
    if (v.status) sets.push(v.status === "done" ? (before.status === "done" ? "completed_at = completed_at" : "completed_at = now()") : "completed_at = NULL");
    if (!sets.length) return res.json((await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [before.id])).rows[0]);
    params.push(before.id, agencyId);
    await pool.query(`UPDATE tasks SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length - 1} AND agency_id = $${params.length}`, params);
    const task = (await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [before.id])).rows[0];
    audit(req, { action: "task.update", entity: "task", entityId: task.id, before, after: task, summary: `${task.client_name}: ${task.title}` });
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating task" });
  }
});

// DELETE /api/tasks/:id
router.delete("/:id", requirePermission("tasks", "delete"), async (req, res) => {
  const before = await fetchBefore("tasks", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Task not found" });
  await pool.query("DELETE FROM tasks WHERE id = $1 AND agency_id = $2", [before.id, req.user.agencyId]);
  audit(req, { action: "task.delete", entity: "task", entityId: before.id, before, summary: before.title });
  res.status(204).send();
});

// POST /api/tasks/generate { month } — create that month's tasks from the monthly templates (idempotent)
router.post("/generate", requirePermission("tasks", "create"), async (req, res) => {
  const month = MONTH_RE.test(String(req.body.month || "")) ? req.body.month : monthOf();
  try {
    const created = await generateTasksForMonth(month, req.user.agencyId);
    audit(req, { action: "task.generate_monthly", entity: "task", entityId: null, after: { month, created }, summary: `${month}: ${created}` });
    res.json({ month, created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating tasks" });
  }
});

// ---- Monthly templates (what we owe each client every month) ----

// GET /api/tasks/templates[?client_id=]
router.get("/templates", requirePermission("tasks", "view"), async (req, res) => {
  const params = [req.user.agencyId];
  let where = "tt.agency_id = $1";
  if (req.query.client_id) { params.push(Number(req.query.client_id) || 0); where += " AND tt.client_id = $2"; }
  const { rows } = await pool.query(
    `SELECT tt.*, c.name AS client_name, u.name AS assignee_name FROM task_templates tt
       JOIN clients c ON c.id = tt.client_id LEFT JOIN users u ON u.id = tt.assignee_id
      WHERE ${where} ORDER BY c.name, tt.id`, params
  );
  res.json(rows);
});

async function parseTemplate(body, agencyId, { partial } = {}) {
  const v = {};
  if (!partial || body.title !== undefined) { v.title = text(body.title, 200); if (!v.title) return { error: "title is required" }; }
  if (body.description !== undefined) v.description = text(body.description, 4000);
  if (body.priority !== undefined) { if (!PRIORITIES.includes(body.priority)) return { error: "invalid priority" }; v.priority = body.priority; }
  if (body.due_day !== undefined) {
    v.due_day = intOrNull(body.due_day);
    if (Number.isNaN(v.due_day) || (v.due_day !== null && (v.due_day < 1 || v.due_day > 31))) return { error: "invalid due_day" };
  }
  if (body.active !== undefined) v.active = !!body.active;
  if (body.assignee_id !== undefined) {
    v.assignee_id = intOrNull(body.assignee_id);
    if (Number.isNaN(v.assignee_id)) return { error: "invalid assignee" };
    if (!(await ownsRow("users", v.assignee_id, agencyId))) return { error: "assignee not found" };
  }
  return { value: v };
}

// POST /api/tasks/templates
router.post("/templates", requirePermission("tasks", "create"), async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const clientId = intOrNull(req.body.client_id);
    if (!clientId || Number.isNaN(clientId) || !(await ownsRow("clients", clientId, agencyId))) return res.status(400).json({ error: "client is required" });
    const { error, value: v } = await parseTemplate(req.body, agencyId);
    if (error) return res.status(400).json({ error });
    const { rows } = await pool.query(
      `INSERT INTO task_templates (agency_id, client_id, title, description, priority, assignee_id, due_day, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [agencyId, clientId, v.title, v.description ?? null, v.priority || "normal", v.assignee_id ?? null, v.due_day ?? null, v.active ?? true]
    );
    audit(req, { action: "task_template.create", entity: "task_template", entityId: rows[0].id, after: rows[0], summary: v.title });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating template" });
  }
});

// POST /api/tasks/templates/defaults { client_id? } — add the standard monthly tasks to one client, or to every active client
router.post("/templates/defaults", requirePermission("tasks", "create"), async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const clientId = intOrNull(req.body && req.body.client_id);
    if (Number.isNaN(clientId) || (clientId !== null && !(await ownsRow("clients", clientId, agencyId)))) return res.status(400).json({ error: "client not found" });
    const result = await seedDefaultTemplates(agencyId, clientId);
    // asking for a specific client's standard tasks switches its tasks back on
    if (clientId) await pool.query("UPDATE clients SET tasks_enabled = true WHERE id = $1 AND agency_id = $2", [clientId, agencyId]);
    audit(req, { action: "task_template.seed_defaults", entity: "task_template", entityId: null, after: result, summary: `${result.created} / ${result.clients}` });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error adding default tasks" });
  }
});

// PUT /api/tasks/templates/:id
router.put("/templates/:id", requirePermission("tasks", "edit"), async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const before = await fetchBefore("task_templates", req.params.id, agencyId);
    if (!before) return res.status(404).json({ error: "Template not found" });
    const { error, value: v } = await parseTemplate(req.body, agencyId, { partial: true });
    if (error) return res.status(400).json({ error });
    const keys = Object.keys(v);
    if (!keys.length) return res.json(before);
    const params = keys.map((k) => v[k]);
    params.push(before.id, agencyId);
    const { rows } = await pool.query(
      `UPDATE task_templates SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = now() WHERE id = $${params.length - 1} AND agency_id = $${params.length} RETURNING *`, params
    );
    audit(req, { action: "task_template.update", entity: "task_template", entityId: before.id, before, after: rows[0], summary: rows[0].title });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating template" });
  }
});

// DELETE /api/tasks/templates/:id (tasks already generated stay)
router.delete("/templates/:id", requirePermission("tasks", "delete"), async (req, res) => {
  const before = await fetchBefore("task_templates", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Template not found" });
  await pool.query("DELETE FROM task_templates WHERE id = $1 AND agency_id = $2", [before.id, req.user.agencyId]);
  audit(req, { action: "task_template.delete", entity: "task_template", entityId: before.id, before, summary: before.title });
  res.status(204).send();
});

module.exports = router;
