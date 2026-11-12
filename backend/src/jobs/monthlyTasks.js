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
      WHERE tt.active AND c.contract_status = 'active'
        AND ($2::int IS NULL OR tt.agency_id = $2::int)
     ON CONFLICT (template_id, month) WHERE template_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [month, agencyId]
  );
  return rows.length;
}

module.exports = { generateTasksForMonth, monthOf, MONTH_RE };
