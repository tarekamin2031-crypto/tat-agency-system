const pool = require("../db/pool");
const { encrypt } = require("./secrets");
const { validateEmail } = require("./settingsValidation");

const PUBLIC = "id, enabled, host, port, secure, username, from_name, from_email, reply_to, notify_payment, notify_overdue, updated_at, (password_enc IS NOT NULL) AS has_password";
const scopeSql = "COALESCE(agency_id, 0) = COALESCE($1::int, 0)";

// The SMTP password is never returned — only whether one is stored.
async function getEmailSettings(agencyId) {
  const { rows } = await pool.query(`SELECT ${PUBLIC} FROM email_settings WHERE ${scopeSql}`, [agencyId]);
  return rows[0] || null;
}

const trim = (v, n) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, n));

/** Validates + upserts. Returns { settings } or { error }. A blank password keeps the stored one. */
async function saveEmailSettings(agencyId, body) {
  const b = body || {};
  const host = trim(b.host, 200);
  const port = b.port === undefined || b.port === "" ? 587 : parseInt(b.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "رقم البورت غير صالح" };
  const fromEmail = trim(b.from_email, 200);
  if (fromEmail && !validateEmail(fromEmail)) return { error: "إيميل المرسل غير صالح" };
  const replyTo = trim(b.reply_to, 200);
  if (replyTo && !validateEmail(replyTo)) return { error: "إيميل الرد غير صالح" };
  const enabled = !!b.enabled;
  if (enabled && !host) return { error: "اكتب عنوان خادم SMTP" };
  if (enabled && !(fromEmail || trim(b.username, 200))) return { error: "اكتب إيميل المرسل" };

  const cur = await pool.query(`SELECT id, password_enc, notify_payment, notify_overdue FROM email_settings WHERE ${scopeSql}`, [agencyId]);
  const password = b.password !== undefined && b.password !== "" ? encrypt(b.password) : (cur.rows[0] ? cur.rows[0].password_enc : null);
  const vals = [
    enabled, host || null, port, !!b.secure, trim(b.username, 200) || null, password,
    trim(b.from_name, 150) || null, fromEmail || null, replyTo || null, b.notify_payment === undefined ? !!(cur.rows[0] && cur.rows[0].notify_payment) : !!b.notify_payment,
    b.notify_overdue === undefined ? !!(cur.rows[0] && cur.rows[0].notify_overdue) : !!b.notify_overdue,
  ];
  if (cur.rows[0]) {
    await pool.query(
      `UPDATE email_settings SET enabled=$1, host=$2, port=$3, secure=$4, username=$5, password_enc=$6, from_name=$7,
        from_email=$8, reply_to=$9, notify_payment=$10, notify_overdue=$11, updated_at=now() WHERE id=$12`,
      [...vals, cur.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO email_settings (enabled, host, port, secure, username, password_enc, from_name, from_email, reply_to, notify_payment, notify_overdue, agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [...vals, agencyId]
    );
  }
  return { settings: await getEmailSettings(agencyId) };
}

module.exports = { getEmailSettings, saveEmailSettings };
