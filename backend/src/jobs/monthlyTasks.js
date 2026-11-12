const pool = require("../db/pool");

// 'YYYY-MM' for a Date (UTC-agnostic: uses the server's calendar month).
function monthOf(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Creates the given month's tasks from every active template of every active client.
 * Idempotent: the unique index (template_id, month) skips what already exists, so it is safe to run
 * from the cron AND from the "generate" button. Returns the number of tasks created.
 */
async function generateTasksForMonth(month, agencyId = null, db = pool) {
  if (!MONTH_RE.test(month)) throw new Error("invalid month");
  const { rows } = await db.query(
    `INSERT INTO tasks (agency_id, client_id, template_id, month, title, description, status, priority, assignee_id, due_date)
     SELECT tt.agency_id, tt.client_id, tt.id, $1::char(7), tt.title, tt.description, 'todo', tt.priority, tt.assignee_id,
            CASE WHEN tt.due_day IS NULL THEN NULL
                 ELSE make_date(split_part($1, '-', 1)::int, split_part($1, '-', 2)::int, 1)
                      + (LEAST(tt.due_day, EXTRACT(day FROM (date_trunc('month', make_date(split_part($1, '-', 1)::int, split_part($1, '-', 2)::int, 1)) + interval '1 month - 1 day'))::int) - 1)
            END
       FROM task_templates tt
       JOIN clients c ON c.id = tt.client_id AND c.agency_id = tt.agency_id
      WHERE tt.active AND c.contract_status = 'active' AND c.tasks_enabled
        AND ($2::int IS NULL OR tt.agency_id = $2::int)
     ON CONFLICT (template_id, month) WHERE template_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [month, agencyId]
  );
  return rows.length;
}

// The standard monthly work of a social-media agency, created as templates for each client.
const DEFAULT_TASKS = [
  "أفكار المحتوى",
  "Content Plan",
  "تصميمات",
  "إعلانات",
  "متابعة الإعلانات",
  "متابعة الاسكادول",
  "متابعة العميل (ميتنج)",
];

/**
 * Adds the default monthly templates to one client (any status) or, with no clientId, to every ACTIVE client of the
 * agency. Titles a client already has are skipped, so it can be run again safely. Returns { created, clients }.
 */
async function seedDefaultTemplates(agencyId, clientId = null, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO task_templates (agency_id, client_id, title, priority)
     SELECT c.agency_id, c.id, d.title, 'normal'
       FROM clients c CROSS JOIN unnest($3::text[]) WITH ORDINALITY AS d(title, ord)
      WHERE c.agency_id = $1::int
        AND (($2::int IS NULL AND c.contract_status = 'active' AND c.tasks_enabled) OR c.id = $2::int)
        AND NOT EXISTS (SELECT 1 FROM task_templates tt WHERE tt.client_id = c.id AND tt.title = d.title)
      ORDER BY c.id, d.ord
     RETURNING client_id`,
    [agencyId, clientId, DEFAULT_TASKS]
  );
  return { created: rows.length, clients: new Set(rows.map((r) => r.client_id)).size };
}

module.exports = { generateTasksForMonth, seedDefaultTemplates, DEFAULT_TASKS, monthOf, MONTH_RE };
