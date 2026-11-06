const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const defaultPool = require("../db/pool");

// Events an endpoint can subscribe to ("*" = all of them).
const EVENTS = [
  "invoice.created", "invoice.paid", "invoice.overdue",
  "client.created", "client.updated", "renewal.upcoming", "payment.recorded",
];

const MAX_ATTEMPTS = 6;
const BACKOFF_MIN = [1, 5, 30, 120, 360]; // minutes before attempts 2..6
const TIMEOUT_MS = 10000;

// ---------- messages & placeholders ----------
// {{name}} / {{data.name}} placeholders work in the URL (GET, e.g. Telegram), the message template and the JSON body.
const MESSAGES = {
  ar: {
    "invoice.created": "🧾 فاتورة جديدة {{number}} — {{client_name}} — {{amount}} {{currency}}",
    "invoice.paid": "✅ فاتورة {{number}} اتسددت — {{client_name}} — {{amount}} {{currency}}",
    "invoice.overdue": "⏰ فاتورة {{number}} متأخرة {{days_overdue}} يوم — {{client_name}}",
    "client.created": "👤 عميل جديد: {{name}}",
    "client.updated": "✏️ تم تعديل العميل: {{name}}",
    "renewal.upcoming": "🔄 تجديد قريب: {{name}} بعد {{days_left}} يوم",
    "payment.recorded": "💰 دفعة {{payment_amount}} {{currency}} على فاتورة {{number}} — {{client_name}}",
    "webhook.test": "🔔 رسالة اختبار من نظام الإدارة",
  },
  en: {
    "invoice.created": "🧾 New invoice {{number}} — {{client_name}} — {{amount}} {{currency}}",
    "invoice.paid": "✅ Invoice {{number}} paid — {{client_name}} — {{amount}} {{currency}}",
    "invoice.overdue": "⏰ Invoice {{number}} is {{days_overdue}} days overdue — {{client_name}}",
    "client.created": "👤 New client: {{name}}",
    "client.updated": "✏️ Client updated: {{name}}",
    "renewal.upcoming": "🔄 Renewal soon: {{name}} in {{days_left}} days",
    "payment.recorded": "💰 Payment {{payment_amount}} {{currency}} on invoice {{number}} — {{client_name}}",
    "webhook.test": "🔔 Test message from the management system",
  },
};
const NUMERIC_KEYS = new Set(["amount", "paid_amount", "payment_amount", "contract_value"]);

function flatten(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === null || v === undefined || typeof v === "object") { if (v instanceof Date) out[k] = v.toISOString().slice(0, 10); continue; }
    out[k] = NUMERIC_KEYS.has(k) && !isNaN(Number(v)) ? Number(v).toLocaleString("en-US") : String(v);
  }
  return out;
}

function fillTemplate(str, vars, encode = false) {
  return String(str || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key] !== undefined ? vars[key] : vars[key.replace(/^data\./, "")];
    const val = v === undefined || v === null ? "" : String(v);
    return encode ? encodeURIComponent(val) : val;
  });
}

/** The human-readable line sent with every event ({{message}}). A custom template wins over the default. */
function buildMessage(event, data, lang = "ar", template = null) {
  const vars = flatten(data);
  const tpl = (template && template.trim()) || (MESSAGES[lang === "en" ? "en" : "ar"][event]) || event;
  return fillTemplate(tpl, vars).replace(/\s+—\s+—/g, " —").replace(/\s+—\s*$/g, "").trim();
}

// Telegram tokens live inside the URL — never show/log them.
const maskUrl = (u) => String(u || "").replace(/\/bot\d+:[\w-]+/g, "/bot***").replace(/([?&](?:token|key|secret|apikey|api_key)=)[^&]+/gi, "$1***");

const newSecret = () => `whsec_${crypto.randomBytes(24).toString("hex")}`;

// HMAC-SHA256 over "<timestamp>.<body>" — receivers recompute and compare.
function sign(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

/** Throws a user-facing Error unless the URL is http(s) and points at a public address. */
async function assertSafeUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error("الرابط غير صالح"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("الرابط لازم يبدأ بـ http أو https");
  if (u.username || u.password) throw new Error("الرابط ما ينفعش يحتوي على اسم مستخدم أو كلمة مرور");
  if (process.env.WEBHOOK_ALLOW_PRIVATE === "1") return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("تعذر الوصول لاسم الدومين");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("الروابط الداخلية/المحلية غير مسموحة");
  return u;
}

async function deliver(id, db = defaultPool) {
  const { rows } = await db.query(
    `SELECT d.*, e.url, e.secret, e.is_active, e.method, e.message_template, a.default_language
       FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id LEFT JOIN agencies a ON a.id = d.agency_id WHERE d.id = $1`, [id]);
  const d = rows[0];
  if (!d || d.status === "success") return d || null;
  if (!d.is_active) {
    await db.query("UPDATE webhook_deliveries SET status = 'failed', error = 'endpoint disabled', next_attempt_at = NULL WHERE id = $1", [id]);
    return { ...d, status: "failed" };
  }
  const attempts = d.attempts + 1;
  const message = buildMessage(d.event, d.payload, d.default_language, d.message_template);
  const method = d.method === "GET" ? "GET" : "POST";
  const vars = { ...flatten(d.payload), event: d.event, message, id: String(d.id), agency_id: String(d.agency_id) };
  const body = JSON.stringify({ id: String(d.id), event: d.event, message, created_at: d.created_at, agency_id: d.agency_id, data: d.payload });
  // Placeholders in the URL are filled (URL-encoded). A GET without any placeholder gets the fields as a query string.
  let target = fillTemplate(d.url, vars, true);
  if (method === "GET" && !/\{\{/.test(d.url)) {
    const u = new URL(target);
    u.searchParams.set("event", d.event); u.searchParams.set("message", message); u.searchParams.set("id", String(d.id));
    for (const [k, v] of Object.entries(flatten(d.payload))) u.searchParams.set(`data_${k}`, v);
    target = u.toString();
  }
  const ts = Math.floor(Date.now() / 1000);
  let status = "failed", responseStatus = null, responseBody = null, error = null;
  try {
    await assertSafeUrl(target);
    const res = await fetch(target, {
      method, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}), "User-Agent": "TAT-Webhooks/1.0",
        "X-TAT-Event": d.event, "X-TAT-Delivery": String(d.id), "X-TAT-Timestamp": String(ts),
        "X-TAT-Signature": `sha256=${sign(d.secret, ts, body)}`,
      },
      ...(method === "POST" ? { body } : {}),
    });
    responseStatus = res.status;
    responseBody = maskUrl((await res.text().catch(() => "")).slice(0, 1000));
    if (res.status >= 200 && res.status < 300) status = "success";
    else error = `HTTP ${res.status}`;
  } catch (err) {
    error = maskUrl(String((err && err.message) || err)).slice(0, 300);
  }

  if (status === "success") {
    await db.query(
      "UPDATE webhook_deliveries SET status='success', attempts=$2, response_status=$3, response_body=$4, error=NULL, delivered_at=now(), next_attempt_at=NULL WHERE id=$1",
      [id, attempts, responseStatus, responseBody]);
  } else if (attempts >= MAX_ATTEMPTS) {
    await db.query(
      "UPDATE webhook_deliveries SET status='failed', attempts=$2, response_status=$3, response_body=$4, error=$5, next_attempt_at=NULL WHERE id=$1",
      [id, attempts, responseStatus, responseBody, error]);
  } else {
    await db.query(
      "UPDATE webhook_deliveries SET status='pending', attempts=$2, response_status=$3, response_body=$4, error=$5, next_attempt_at = now() + ($6 || ' minutes')::interval WHERE id=$1",
      [id, attempts, responseStatus, responseBody, error, String(BACKOFF_MIN[attempts - 1] || 360)]);
  }
  return (await db.query("SELECT id, event, status, attempts, response_status, response_body, error, created_at, delivered_at FROM webhook_deliveries WHERE id = $1", [id])).rows[0];
}

/** Records the event for every subscribed endpoint of the agency and sends in the background. Never throws. */
async function emit(agencyId, event, data, db = defaultPool) {
  try {
    if (!agencyId) return 0;
    const { rows } = await db.query(
      "SELECT id FROM webhook_endpoints WHERE agency_id = $1 AND is_active AND ($2 = ANY(events) OR '*' = ANY(events))", [agencyId, event]);
    const ids = [];
    for (const e of rows) {
      const r = await db.query("INSERT INTO webhook_deliveries (endpoint_id, agency_id, event, payload) VALUES ($1,$2,$3,$4::jsonb) RETURNING id",
        [e.id, agencyId, event, JSON.stringify(data ?? {})]);
      ids.push(r.rows[0].id);
    }
    // fire-and-forget: the request that caused the event must never wait on a customer's server
    if (ids.length) setImmediate(() => ids.forEach((id) => deliver(id, db).catch((err) => console.error("[webhooks]", err.message))));
    return ids.length;
  } catch (err) {
    console.error("[webhooks] emit failed:", event, err.message);
    return 0;
  }
}

// Retry worker: claims due deliveries (so overlapping runs don't double-send) and sends them.
async function processWebhookQueue(db = defaultPool) {
  const { rows } = await db.query(
    `UPDATE webhook_deliveries SET next_attempt_at = now() + interval '2 minutes'
      WHERE id IN (SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY id LIMIT 20)
      RETURNING id`);
  for (const r of rows) await deliver(r.id, db).catch((err) => console.error("[webhooks]", err.message));
  return rows.length;
}

module.exports = { fillTemplate, buildMessage, flatten, maskUrl, MESSAGES, EVENTS, newSecret, sign, assertSafeUrl, isPrivateIp, deliver, emit, processWebhookQueue, MAX_ATTEMPTS };
