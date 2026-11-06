const defaultPool = require("../db/pool");
const { background } = require("./background");

// Never store secrets or binary blobs in the log.
const REDACT = /(_data$|password|token_version|^password_hash$)/i;

function clean(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.test(k) || Buffer.isBuffer(v)) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

// For updates keep only the fields that actually changed (before/after side by side).
function changedOnly(before, after) {
  if (!before || !after) return { before, after };
  const b = {}, a = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { b[k] = before[k]; a[k] = after[k]; }
  }
  return { before: b, after: a };
}

/**
 * Records an audit event. Never throws and never blocks the request: a logging
 * problem must not break the action being logged.
 *
 *   audit(req, { action: "invoice.update", entity: "invoice", entityId: id, before, after, summary })
 *   audit(req, { action: "auth.login_failed", user: { email }, agencyId: null })
 */
async function writeAudit(req, { action, entity = null, entityId = null, before = null, after = null, summary = null, user = null, agencyId, db = defaultPool }) {
  try {
    const actor = user || (req && req.user) || {};
    let b = clean(before), a = clean(after);
    if (/\.update$/.test(action) && b && a) ({ before: b, after: a } = changedOnly(b, a));
    // an update that changed nothing is not worth a log line
    if (/\.update$/.test(action) && b && a && Object.keys(a).length === 0) return;
    await db.query(
      `INSERT INTO audit_logs (agency_id, user_id, user_name, user_email, action, entity, entity_id, summary, before_data, after_data, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
      [
        agencyId !== undefined ? agencyId : (actor.agencyId ?? null),
        actor.id ?? null, actor.name ?? null, actor.email ?? null,
        action, entity, entityId === null || entityId === undefined ? null : String(entityId), summary,
        b ? JSON.stringify(b) : null, a ? JSON.stringify(a) : null,
        req && (req.ip || null), req && req.headers ? String(req.headers["user-agent"] || "").slice(0, 300) : null,
      ]
    );
  } catch (err) {
    console.error("[audit] failed to record", action, err.message);
  }
}

function audit(req, opts) {
  const p = writeAudit(req, opts);
  background(p);
  return p;
}

// Convenience: read one row (scoped to the agency) so a handler can log "before".
async function fetchBefore(table, id, agencyId, db = defaultPool) {
  const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND agency_id = $2`, [id, agencyId]);
  return rows[0] || null;
}

module.exports = { audit, fetchBefore, clean, changedOnly };
