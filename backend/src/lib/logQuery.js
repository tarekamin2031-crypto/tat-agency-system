const pool = require("../db/pool");

const MAX_LIMIT = 200;

// Builds the filtered, paginated audit-log query shared by the agency log page
// and the platform-wide log. `agencyId` pins the agency (null = every agency,
// only ever passed for platform admins).
//
// Filters: user_id, entity, action (exact or prefix like "invoice."), from, to, q (free text)
async function queryLogs({ agencyId, filters = {}, page = 1, limit = 50, db = pool }) {
  const cond = [];
  const params = [];
  const add = (sql, val) => { params.push(val); cond.push(sql.replace("?", `$${params.length}`)); };

  if (agencyId !== null && agencyId !== undefined) add("l.agency_id = ?", agencyId);
  else if (filters.agency_id) add("l.agency_id = ?", Number(filters.agency_id));

  if (filters.user_id) add("l.user_id = ?", Number(filters.user_id));
  if (filters.entity) add("l.entity = ?", String(filters.entity));
  if (filters.entity_id) add("l.entity_id = ?", String(filters.entity_id));
  if (filters.action) {
    const a = String(filters.action);
    if (a.endsWith(".")) add("l.action LIKE ?", `${a.replace(/[%_]/g, "")}%`);
    else add("l.action = ?", a);
  }
  if (filters.from) add("l.created_at >= ?", `${filters.from} 00:00:00`);
  if (filters.to) add("l.created_at < (?::date + 1)", filters.to);
  if (filters.q) {
    params.push(`%${String(filters.q).replace(/[%_]/g, "")}%`);
    const n = params.length;
    cond.push(`(l.summary ILIKE $${n} OR l.user_name ILIKE $${n} OR l.user_email ILIKE $${n} OR l.action ILIKE $${n} OR l.entity_id ILIKE $${n})`);
  }

  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), MAX_LIMIT);
  const pg = Math.max(parseInt(page, 10) || 1, 1);

  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs l ${where}`, params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT l.id, l.agency_id, a.name AS agency_name, l.user_id, l.user_name, l.user_email, l.action, l.entity, l.entity_id,
              l.summary, l.before_data, l.after_data, l.ip, l.user_agent, l.created_at
         FROM audit_logs l LEFT JOIN agencies a ON a.id = l.agency_id
         ${where}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${lim} OFFSET ${(pg - 1) * lim}`,
      params
    )
  ).rows;

  return { rows, total, page: pg, limit: lim, pages: Math.max(Math.ceil(total / lim), 1) };
}

// Distinct values for the filter dropdowns.
async function logFilterOptions({ agencyId, db = pool }) {
  const scope = agencyId !== null && agencyId !== undefined ? "WHERE agency_id = $1" : "";
  const p = scope ? [agencyId] : [];
  const actions = (await db.query(`SELECT DISTINCT action FROM audit_logs ${scope} ORDER BY action`, p)).rows.map((r) => r.action);
  const entities = (await db.query(`SELECT DISTINCT entity FROM audit_logs ${scope ? scope + " AND" : "WHERE"} entity IS NOT NULL ORDER BY entity`, p)).rows.map((r) => r.entity);
  const users = (
    await db.query(
      `SELECT DISTINCT user_id AS id, COALESCE(user_name, user_email) AS name FROM audit_logs
        ${scope ? scope + " AND" : "WHERE"} user_id IS NOT NULL ORDER BY name`,
      p
    )
  ).rows;
  return { actions, entities, users };
}

module.exports = { queryLogs, logFilterOptions };
