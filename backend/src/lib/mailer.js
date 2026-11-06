const nodemailer = require("nodemailer");
const defaultPool = require("../db/pool");
const { decrypt } = require("./secrets");
const { render } = require("./emailTemplates");

const MAX_ATTEMPTS = 4;
const BACKOFF_MIN = [1, 5, 30]; // minutes before attempts 2, 3, 4

// Tests can swap the transport (e.g. nodemailer's jsonTransport) without a network.
let transportFactory = (cfg) =>
  nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: !!cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
const setTransportFactory = (fn) => { transportFactory = fn; };

function fromEnv() {
  if (!process.env.SMTP_HOST) return null;
  return {
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true",
    username: process.env.SMTP_USER || null, password: process.env.SMTP_PASS || null,
    from_name: process.env.SMTP_FROM_NAME || "TAT Agency", from_email: process.env.SMTP_FROM || process.env.SMTP_USER, source: "env",
  };
}

// An agency's own enabled SMTP wins; otherwise the platform default (DB row, then env).
async function resolveSmtp(agencyId, db = defaultPool) {
  const { rows } = await db.query(
    `SELECT * FROM email_settings WHERE enabled AND host IS NOT NULL AND (agency_id = $1 OR agency_id IS NULL)
     ORDER BY agency_id NULLS LAST LIMIT 1`,
    [agencyId ?? 0]
  );
  const r = rows[0];
  if (r) {
    return {
      host: r.host, port: r.port, secure: r.secure, username: r.username, password: decrypt(r.password_enc),
      from_name: r.from_name, from_email: r.from_email || r.username, reply_to: r.reply_to,
      source: r.agency_id ? "agency" : "platform",
    };
  }
  return fromEnv();
}

async function attempt(row, cfg, db) {
  const transport = transportFactory(cfg);
  await transport.sendMail({
    from: cfg.from_name ? `"${String(cfg.from_name).replace(/"/g, "")}" <${cfg.from_email}>` : cfg.from_email,
    to: row.to_email, replyTo: cfg.reply_to || undefined, subject: row.subject, html: row.body_html, text: row.body_text,
  });
}

// Sends one queued log row; schedules a retry on failure.
async function deliver(id, db = defaultPool) {
  const { rows } = await db.query("SELECT * FROM email_log WHERE id = $1", [id]);
  const row = rows[0];
  if (!row || row.status === "sent") return { ok: row ? true : false };
  const cfg = await resolveSmtp(row.agency_id, db);
  if (!cfg) {
    await db.query("UPDATE email_log SET status = 'failed', error = 'no_smtp', attempts = attempts + 1, next_attempt_at = NULL WHERE id = $1", [id]);
    return { ok: false, error: "no_smtp" };
  }
  const attempts = row.attempts + 1;
  try {
    await attempt(row, cfg, db);
    await db.query("UPDATE email_log SET status = 'sent', attempts = $2, error = NULL, sent_at = now(), next_attempt_at = NULL WHERE id = $1", [id, attempts]);
    return { ok: true };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).slice(0, 500);
    if (attempts >= MAX_ATTEMPTS) {
      await db.query("UPDATE email_log SET status = 'failed', attempts = $2, error = $3, next_attempt_at = NULL WHERE id = $1", [id, attempts, msg]);
    } else {
      const mins = BACKOFF_MIN[attempts - 1] || 30;
      await db.query(
        "UPDATE email_log SET status = 'queued', attempts = $2, error = $3, next_attempt_at = now() + ($4 || ' minutes')::interval WHERE id = $1",
        [id, attempts, msg, String(mins)]
      );
    }
    return { ok: false, error: msg };
  }
}

/**
 * Queue + send an email. Never throws; resolves { ok, error?, id }.
 *   sendEmail({ agencyId, to, template, lang, vars, brand, wait })
 * `wait: true` returns after the first attempt (used by "send test"); otherwise
 * the first attempt runs in the background.
 */
async function sendEmail({ agencyId = null, to, template, lang = "ar", vars = {}, brand, wait = false, db = defaultPool }) {
  try {
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to))) return { ok: false, error: "invalid_recipient" };
    const content = render(template, lang, vars, brand || "TAT Agency");
    const { rows } = await db.query(
      `INSERT INTO email_log (agency_id, to_email, subject, template, lang, body_html, body_text, status, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'queued', now()) RETURNING id`,
      [agencyId, String(to).trim(), content.subject, template, lang, content.html, content.text]
    );
    const id = rows[0].id;
    // Without any SMTP there is nothing to retry: record the failure right away.
    const job = deliver(id, db).catch((e) => ({ ok: false, error: String(e && e.message) }));
    if (wait) return { ...(await job), id };
    return { ok: true, queued: true, id };
  } catch (err) {
    console.error("[mailer] sendEmail failed:", err.message);
    return { ok: false, error: String(err.message || err) };
  }
}

// Retry worker: picks queued rows that are due.
async function processEmailQueue(db = defaultPool) {
  const { rows } = await db.query("SELECT id FROM email_log WHERE status = 'queued' AND next_attempt_at <= now() ORDER BY id LIMIT 20");
  for (const r of rows) await deliver(r.id, db);
  return rows.length;
}

module.exports = { sendEmail, processEmailQueue, resolveSmtp, deliver, setTransportFactory, MAX_ATTEMPTS };
