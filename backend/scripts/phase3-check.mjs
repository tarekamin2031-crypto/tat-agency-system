// Phase 3 end-to-end check (email, password reset/invite, webhooks, daily events) against a RUNNING backend.
//
//   WEBHOOK_ALLOW_PRIVATE=1 must be set on the backend (the receiver runs on localhost), and the DB env
//   (DB_HOST…) must be set here too because the daily job is invoked directly.
//   BASE_URL=http://localhost:4000 PLATFORM_EMAIL=… PLATFORM_PASSWORD=… node scripts/phase3-check.mjs
//
// It starts a tiny SMTP sink and an HTTP webhook receiver, creates a throw-away agency (suspended at the end).
import net from "net";
import http from "http";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
process.env.WEBHOOK_ALLOW_PRIVATE = "1"; // the daily job runs in this process and posts to the local receiver
const BASE = (process.env.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const { PLATFORM_EMAIL, PLATFORM_PASSWORD } = process.env;
if (!PLATFORM_EMAIL || !PLATFORM_PASSWORD) { console.error("Set PLATFORM_EMAIL and PLATFORM_PASSWORD."); process.exit(2); }

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const login = async (email, password) => { const r = await call(null, "POST", "/api/auth/login", { email, password }); return r.status === 200 ? r.data : null; };

// ---------- SMTP sink ----------
const mails = [];
const smtp = net.createServer((sock) => {
  let buf = "", inData = false, cur = { to: [], data: "" };
  sock.write("220 sink ESMTP\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) {
        if (line === ".") { inData = false; mails.push({ ...cur }); cur = { to: [], data: "" }; sock.write("250 queued\r\n"); }
        else cur.data += line.replace(/^\.\./, ".") + "\n";
        continue;
      }
      const u = line.toUpperCase();
      if (u.startsWith("EHLO") || u.startsWith("HELO")) sock.write("250-sink\r\n250 8BITMIME\r\n");
      else if (u.startsWith("MAIL FROM")) sock.write("250 ok\r\n");
      else if (u.startsWith("RCPT TO")) { cur.to.push(line.slice(8).replace(/[<>\s]/g, "")); sock.write("250 ok\r\n"); }
      else if (u === "DATA") { inData = true; sock.write("354 go\r\n"); }
      else if (u === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
      else sock.write("250 ok\r\n");
    }
  });
});
await new Promise((r) => smtp.listen(0, "127.0.0.1", r));
const smtpPort = smtp.address().port;
// decodes the body parts of a mail: base64 parts are decoded, quoted-printable parts un-escaped
const decodeQP = (raw) => {
  let out = "";
  for (const part of raw.split(/^--.*$/m)) {
    const m = /^([\s\S]*?)\n\n([\s\S]*)$/.exec(part.replace(/^\n/, ""));
    if (!m) { out += part; continue; }
    const enc = (/content-transfer-encoding:\s*(\S+)/i.exec(m[1]) || [])[1];
    const body = m[2];
    if (enc && enc.toLowerCase() === "base64") out += Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8") + "\n";
    else if (enc && enc.toLowerCase() === "quoted-printable") out += body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) + "\n";
    else out += body + "\n";
  }
  return out;
};
const subjectOf = (m) => { const raw = (/^Subject: ((?:.*\n )*.*)$/m.exec(m.data) || [])[1] || ""; return raw.replace(/\n /g, "").replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_, k, t) => k.toUpperCase() === "B" ? Buffer.from(t, "base64").toString("utf8") : t.replace(/_/g, " ").replace(/=([0-9A-F]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)))); };
const mailTo = (addr) => mails.filter((m) => m.to.includes(addr));

// ---------- webhook receiver ----------
const hooks = [];
let receiverStatus = 200;
const receiver = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { hooks.push({ headers: req.headers, body, path: req.url, method: req.method }); res.statusCode = receiverStatus; res.end("ok"); });
});
await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
const hookUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
const verify = (h, secret) => {
  const ts = h.headers["x-tat-timestamp"];
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${h.body}`).digest("hex");
  return h.headers["x-tat-signature"] === expected;
};

const stamp = Date.now().toString(36);
const PASS = `Ph3-${stamp}-Pw1!`;
const platform = await login(PLATFORM_EMAIL, PLATFORM_PASSWORD);
if (!platform) { console.error("platform login failed"); process.exit(2); }

console.log("\n# setup: two agencies");
const mk = (tag) => ({ name: `P3 ${tag} ${stamp}`, admin: { name: `Admin ${tag}`, email: `p3-${tag.toLowerCase()}-${stamp}@example.test`, password: PASS } });
const A = await call(platform.token, "POST", "/api/platform/agencies", mk("A"));
const B = await call(platform.token, "POST", "/api/platform/agencies", mk("B"));
check("agencies created", A.status === 201 && B.status === 201);
const adminA = await login(mk("A").admin.email, PASS);
const adminB = await login(mk("B").admin.email, PASS);
const tokenA = adminA.token, tokenB = adminB.token;

console.log("\n# email settings + test message");
check("no SMTP yet -> test fails with a clear message", (await call(tokenA, "POST", "/api/email/test", { to: "x@example.test" })).status === 400);
const bad = await call(tokenA, "PUT", "/api/email/settings", { enabled: true, host: "", port: 587 });
check("enabling without host is rejected", bad.status === 400);
const put = await call(tokenA, "PUT", "/api/email/settings", { enabled: true, host: "127.0.0.1", port: smtpPort, secure: false, from_name: "P3 A", from_email: "noreply@example.test", password: "s3cret-pass", notify_payment: true, notify_overdue: true });
check("SMTP settings saved", put.status === 200 && put.data.settings.has_password === true && put.data.settings.password === undefined && !JSON.stringify(put.data).includes("s3cret-pass"));
const test = await call(tokenA, "POST", "/api/email/test", { to: "owner@example.test", lang: "en" });
check("test email accepted", test.status === 200, JSON.stringify(test.data));
const got = await until(() => mailTo("owner@example.test")[0]);
check("sink received the test email (English)", !!got && subjectOf(got) === "Test message");
const kept = await call(tokenA, "PUT", "/api/email/settings", { enabled: true, host: "127.0.0.1", port: smtpPort, from_email: "noreply@example.test" });
check("blank password keeps the stored one", kept.status === 200 && kept.data.settings.has_password === true);
const log = await call(tokenA, "GET", "/api/email/log");
check("email log shows the message as sent", log.data.some((m) => m.to_email === "owner@example.test" && m.status === "sent"));
check("agency B sees none of A's email settings/log", (await call(tokenB, "GET", "/api/email/settings")).data.settings === null && (await call(tokenB, "GET", "/api/email/log")).data.length === 0);
check("viewer-less agency B can't read A's log via platform route", (await call(tokenA, "GET", "/api/platform/email")).status === 403);

console.log("\n# password reset");
const adminEmail = mk("A").admin.email;
check("forgot-password answers ok for unknown email too", (await call(null, "POST", "/api/auth/forgot-password", { email: "nobody@example.test" })).status === 200);
check("forgot-password ok for a real email", (await call(null, "POST", "/api/auth/forgot-password", { email: adminEmail })).status === 200);
const resetMail = await until(() => mailTo(adminEmail)[0]);
const resetBody = resetMail ? decodeQP(resetMail.data) : "";
if (process.env.DEBUG_MAIL) console.log("DECODED:", JSON.stringify(resetBody.slice(0, 400)));
const tok = (resetBody.match(/reset-password\?token=([0-9a-f]{64})/) || [])[1];
check("reset email contains a one-time link", !!tok);
check("weak password is refused", (await call(null, "POST", "/api/auth/reset-password", { token: tok, new_password: "short" })).status === 400);
const NEWPASS = `Reset-${stamp}-Pw2!`;
check("reset with the token works", (await call(null, "POST", "/api/auth/reset-password", { token: tok, new_password: NEWPASS })).status === 200);
check("token cannot be reused", (await call(null, "POST", "/api/auth/reset-password", { token: tok, new_password: NEWPASS + "x" })).status === 400);
check("old password no longer works", (await login(adminEmail, PASS)) === null);
const adminA2 = await login(adminEmail, NEWPASS);
check("new password works", !!adminA2);
check("old session token was invalidated", (await call(tokenA, "GET", "/api/auth/me")).status === 401);
const tA = adminA2.token;

console.log("\n# invite by email");
const roles = (await call(tA, "GET", "/api/roles")).data.roles;
const invEmail = `p3-invited-${stamp}@example.test`;
const created = await call(tA, "POST", "/api/auth/users", { name: "Invited", email: invEmail, role_id: roles.find((r) => r.key === "viewer").id, send_invite: true });
check("user created with no password + invite", created.status === 201 && created.data.invite_sent === true, JSON.stringify(created.data));
const inviteMail = await until(() => mailTo(invEmail)[0]);
const itok = inviteMail && (decodeQP(inviteMail.data).match(/reset-password\?token=([0-9a-f]{64})/) || [])[1];
check("invite email has a set-password link", !!itok);
check("invited user sets a password", (await call(null, "POST", "/api/auth/reset-password", { token: itok, new_password: `Invite-${stamp}-Pw3!` })).status === 200);
check("invited user can sign in", !!(await login(invEmail, `Invite-${stamp}-Pw3!`)));

console.log("\n# webhooks");
check("private/internal URLs are rejected by default policy helper", (() => { const { isPrivateIp } = require("../src/lib/webhooks.js"); return isPrivateIp("10.0.0.5") && isPrivateIp("127.0.0.1") && isPrivateIp("169.254.169.254") && isPrivateIp("::1") && !isPrivateIp("8.8.8.8"); })());
check("bad url refused", (await call(tA, "POST", "/api/webhooks", { url: "ftp://x.test/a", events: ["invoice.created"] })).status === 400);
check("no events refused", (await call(tA, "POST", "/api/webhooks", { url: hookUrl, events: [] })).status === 400);
const ep = (await call(tA, "POST", "/api/webhooks", { url: hookUrl, description: "p3", events: ["invoice.created", "invoice.paid", "invoice.overdue", "client.created", "payment.recorded"] })).data;
check("endpoint created with a secret", ep && ep.secret && ep.secret.startsWith("whsec_"));
check("agency B can't see/modify A's webhook", (await call(tokenB, "GET", "/api/webhooks")).data.length === 0 && (await call(tokenB, "PUT", `/api/webhooks/${ep.id}`, { is_active: false })).status === 404 && (await call(tokenB, "DELETE", `/api/webhooks/${ep.id}`)).status === 404 && (await call(tokenB, "GET", `/api/webhooks/${ep.id}/deliveries`)).status === 404);

const t1 = await call(tA, "POST", `/api/webhooks/${ep.id}/test`);
check("test button delivers a signed event", t1.status === 200 && t1.data.status === "success");
const th = hooks.find((h) => h.headers["x-tat-event"] === "webhook.test");
check("signature verifies with the secret", !!th && verify(th, ep.secret));

const client = (await call(tA, "POST", "/api/clients", { name: `Hook Client ${stamp}`, status: "Active", contract_value: 100, currency: "EGP", renewal_cycle: "monthly", contact_email: "client@example.test", contact_name: "Client" })).data;
const h1 = await until(() => hooks.find((h) => h.headers["x-tat-event"] === "client.created"));
check("client.created delivered", !!h1 && JSON.parse(h1.body).data.name === `Hook Client ${stamp}` && verify(h1, ep.secret));
const inv = (await call(tA, "POST", "/api/invoices", { client_id: client.id, number: `P3-${stamp}`, amount: 300, issue_date: "2026-01-01", due_date: "2026-12-31", status: "sent" })).data;
const h2 = await until(() => hooks.find((h) => h.headers["x-tat-event"] === "invoice.created"));
check("invoice.created delivered", !!h2 && JSON.parse(h2.body).data.number === `P3-${stamp}`);
await call(tA, "POST", `/api/invoices/${inv.id}/record-payment`, { amount: 300 });
const h3 = await until(() => hooks.find((h) => h.headers["x-tat-event"] === "invoice.paid"));
const h4 = await until(() => hooks.find((h) => h.headers["x-tat-event"] === "payment.recorded"));
check("invoice.paid + payment.recorded delivered", !!h3 && !!h4 && JSON.parse(h4.body).data.payment_amount === 300);
const payMail = await until(() => mails.find((m) => m.to.includes(adminEmail) && decodeQP(m.data).includes(`P3-${stamp}`)));
check("admin got the 'payment received' email (notify_payment on)", !!payMail);

console.log("\n# GET webhooks / Telegram-style");
const tgUrl = `http://127.0.0.1:${receiver.address().port}/tg/bot123456:AA-secretTOKEN/sendMessage?chat_id=-100&text={{message}}`;
const tg = (await call(tA, "POST", "/api/webhooks", { kind: "telegram", method: "GET", url: tgUrl, events: ["invoice.paid", "client.created"] })).data;
check("telegram-style GET endpoint created", tg && tg.method === "GET" && tg.kind === "telegram");
await call(tA, "POST", "/api/clients", { name: `Telegram Client ${stamp}`, status: "Active", contract_value: 1, currency: "EGP", renewal_cycle: "monthly" });
const tgHit = await until(() => hooks.find((h) => h.path.startsWith("/tg/") && h.path.includes("chat_id=-100")));
const tgText = tgHit && decodeURIComponent((/text=([^&]*)/.exec(tgHit.path) || [])[1] || "");
check("GET delivered with the message in the query (Arabic default)", !!tgHit && tgText.includes(`Telegram Client ${stamp}`) && tgText.includes("عميل جديد"), tgText);
check("GET has no body but is still signed", tgHit && tgHit.body === "" && !!tgHit.headers["x-tat-signature"] && tgHit.method === "GET");
const tpl = await call(tA, "PUT", `/api/webhooks/${tg.id}`, { message_template: "NEW CLIENT >> {{name}}" });
check("custom message template saved", tpl.status === 200 && tpl.data.message_template === "NEW CLIENT >> {{name}}");
await call(tA, "POST", "/api/clients", { name: `Tpl Client ${stamp}`, status: "Active", contract_value: 1, currency: "EGP", renewal_cycle: "monthly" });
const tplHit = await until(() => hooks.find((h) => h.path.startsWith("/tg/") && decodeURIComponent(h.path).includes(`NEW CLIENT >> Tpl Client ${stamp}`)));
check("custom template is used instead of the default", !!tplHit);
const plain = (await call(tA, "POST", "/api/webhooks", { method: "GET", url: `http://127.0.0.1:${receiver.address().port}/plain`, events: ["client.created"] })).data;
await call(tA, "POST", "/api/clients", { name: `Plain Client ${stamp}`, status: "Active", contract_value: 1, currency: "EGP", renewal_cycle: "monthly" });
const plainHit = await until(() => hooks.find((h) => h.path.startsWith("/plain") && h.path.includes("event=client.created")));
check("GET without placeholders gets event/message/data_* query params", !!plainHit && plainHit.path.includes("data_name=Plain") && plainHit.path.includes("message="));
const badM = (await call(tA, "POST", "/api/webhooks", { method: "DELETE", url: hookUrl, events: ["client.created"] })).data;
check("bad method falls back to POST", badM.method === "POST");
await call(tA, "DELETE", `/api/webhooks/${badM.id}`);
const auditAll = JSON.stringify((await call(tA, "GET", "/api/logs?limit=200")).data);
check("bot token never reaches the audit log", !auditAll.includes("secretTOKEN"));
const dlv = JSON.stringify((await call(tA, "GET", `/api/webhooks/${tg.id}/deliveries`)).data);
check("bot token never shown in delivery log", !dlv.includes("secretTOKEN"));
await call(tA, "PUT", `/api/webhooks/${tg.id}`, { is_active: false });
await call(tA, "PUT", `/api/webhooks/${plain.id}`, { is_active: false });

console.log("\n# retries");
receiverStatus = 500;
const before = hooks.length;
await call(tA, "POST", "/api/clients", { name: `Retry Client ${stamp}`, status: "Active", contract_value: 1, currency: "EGP", renewal_cycle: "monthly" });
await until(() => hooks.length > before);
const dl = await until(async () => { const r = (await call(tA, "GET", `/api/webhooks/${ep.id}/deliveries`)).data; return r.find((d) => d.event === "client.created" && d.attempts >= 1 && d.status === "pending"); });
check("failed delivery is kept pending with a retry time", !!dl && !!dl.next_attempt_at && dl.response_status === 500);
receiverStatus = 200;
const re = await call(tA, "POST", `/api/webhooks/deliveries/${dl.id}/redeliver`);
check("redeliver succeeds once the receiver recovers", re.status === 200 && re.data.status === "success");
const rot = await call(tA, "POST", `/api/webhooks/${ep.id}/rotate`);
check("rotating changes the secret", rot.data.secret && rot.data.secret !== ep.secret);
await call(tA, "POST", `/api/webhooks/${ep.id}/test`);
const lastTest = hooks.filter((h) => h.headers["x-tat-event"] === "webhook.test").pop();
check("new deliveries use the new secret", verify(lastTest, rot.data.secret) && !verify(lastTest, ep.secret));
check("disabled endpoint receives nothing", (await call(tA, "PUT", `/api/webhooks/${ep.id}`, { is_active: false })).status === 200);
const n0 = hooks.length;
await call(tA, "POST", "/api/clients", { name: `Silent Client ${stamp}`, status: "Active", contract_value: 1, currency: "EGP", renewal_cycle: "monthly" });
await sleep(800);
check("…no event after disabling", hooks.length === n0);
await call(tA, "PUT", `/api/webhooks/${ep.id}`, { is_active: true });

console.log("\n# daily events");
const od = (await call(tA, "POST", "/api/invoices", { client_id: client.id, number: `P3OD-${stamp}`, amount: 50, issue_date: "2026-01-01", due_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), status: "sent" })).data;
const { runForAgency } = require("../src/jobs/dailyEvents.js");
const r1 = await runForAgency(A.data.id);
const ho = await until(() => hooks.find((h) => h.headers["x-tat-event"] === "invoice.overdue" && JSON.parse(h.body).data.number === `P3OD-${stamp}`));
check("overdue invoice announced once", r1.overdue >= 1 && !!ho);
const r2 = await runForAgency(A.data.id);
check("second run does not repeat it", r2.overdue === 0);
const digest = await until(() => mails.find((m) => m.to.includes(adminEmail) && decodeQP(m.data).includes(`P3OD-${stamp}`)));
check("admin overdue digest emailed (notify_overdue on)", !!digest);

console.log("\n# collection email reminder");
const entries = (await call(tA, "GET", "/api/collection")).data;
const entry = entries.find((e) => e.invoice_number === `P3OD-${stamp}`);
const rem = await call(tA, "POST", `/api/collection/${entry.id}/quick-action`, { action: "email_reminder", lang: "en" });
check("reminder email sent to the client", rem.status === 200);
const remMail = await until(() => mailTo("client@example.test")[0]);
check("client received an English reminder with the invoice number", !!remMail && decodeQP(remMail.data).includes(`P3OD-${stamp}`) && subjectOf(remMail).startsWith("Payment reminder"));

console.log("\n# platform email");
check("agency admin can't touch platform SMTP", (await call(tA, "PUT", "/api/platform/email", { enabled: false })).status === 403);
const pe = await call(platform.token, "GET", "/api/platform/email");
check("platform owner can read platform SMTP", pe.status === 200);

console.log("\n# landing page contact form");
// send platform mail through the sink for this section
await call(platform.token, "PUT", "/api/platform/email", { enabled: true, host: "127.0.0.1", port: smtpPort, secure: false, from_email: "noreply@example.test", from_name: "TAT" });
const leadEmail = `lead-${stamp}@example.test`;
check("invalid email rejected", (await call(null, "POST", "/api/public/contact", { name: "Sara", email: "nope", message: "hi" })).status === 400);
check("empty message + phone rejected", (await call(null, "POST", "/api/public/contact", { name: "Sara", email: leadEmail })).status === 400);
check("bad phone rejected", (await call(null, "POST", "/api/public/contact", { name: "Sara", email: leadEmail, phone: "abc", message: "x" })).status === 400);
const bot = await call(null, "POST", "/api/public/contact", { name: "Bot", email: `bot-${stamp}@example.test`, message: "buy now", website: "http://spam" });
check("honeypot pretends success", bot.status === 201);
const sent = await call(null, "POST", "/api/public/contact", { name: `Lead ${stamp}`, email: leadEmail, phone: "+20 100 123 4567", company: "Acme Ads", team_size: "6-15", interest: "pricing", message: "نحتاج عرض سعر", lang: "en", team_size_x: "ignored" });
check("valid request accepted", sent.status === 201 && sent.data.ok === true);
const inbox = await call(platform.token, "GET", "/api/platform/leads");
const lead = inbox.data.leads.find((l) => l.email === leadEmail);
check("lead stored with all fields", !!lead && lead.company === "Acme Ads" && lead.team_size === "6-15" && lead.interest === "pricing" && lead.lang === "en" && lead.status === "new");
check("honeypot lead was NOT stored", !inbox.data.leads.some((l) => l.email === `bot-${stamp}@example.test`));
const ack = await until(() => mailTo(leadEmail)[0]);
check("visitor got a confirmation in their language (English)", !!ack && subjectOf(ack) === "We got your message");
const ownerMail = await until(() => mails.find((m) => m.to.includes(PLATFORM_EMAIL) && decodeQP(m.data).includes(leadEmail)));
check("platform owner was notified with the details", !!ownerMail && decodeQP(ownerMail.data).includes("Acme Ads"));
check("agency admins cannot read the inbox", (await call(tA, "GET", "/api/platform/leads")).status === 403);
check("anonymous cannot read the inbox", (await call(null, "GET", "/api/platform/leads")).status === 401);
const st = await call(platform.token, "PATCH", `/api/platform/leads/${lead.id}`, { status: "contacted", notes: "called" });
check("status + notes update", st.status === 200 && st.data.status === "contacted" && st.data.notes === "called");
check("bad status refused", (await call(platform.token, "PATCH", `/api/platform/leads/${lead.id}`, { status: "weird" })).status === 400);
check("filter by status", (await call(platform.token, "GET", "/api/platform/leads?status=new")).data.leads.every((l) => l.status === "new"));
check("delete lead", (await call(platform.token, "DELETE", `/api/platform/leads/${lead.id}`)).status === 204);
await call(platform.token, "PUT", "/api/platform/email", { enabled: false });

console.log("\n# audit trail");
const logs = (await call(tA, "GET", "/api/logs?limit=200")).data.rows.map((l) => l.action);
for (const a of ["settings.email_update", "settings.email_test", "webhook.create", "webhook.rotate", "auth.password_reset_request", "auth.password_reset"]) check(`logged: ${a}`, logs.includes(a));
check("secrets never reach the log", !JSON.stringify((await call(tA, "GET", "/api/logs?limit=200")).data).includes(rot.data.secret) && !JSON.stringify((await call(tA, "GET", "/api/logs?limit=200")).data).includes("s3cret-pass"));

await call(platform.token, "PATCH", `/api/platform/agencies/${A.data.id}`, { is_active: false });
await call(platform.token, "PATCH", `/api/platform/agencies/${B.data.id}`, { is_active: false });
smtp.close(); receiver.close();
if (process.env.DEBUG_MAIL) console.log(mails.map((m) => m.to.join(",") + " | " + ((/^Subject: (.*)$/m.exec(m.data) || [])[1] || "")).join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
