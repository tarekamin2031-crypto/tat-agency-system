const express = require("express");
const crypto = require("crypto");
const { runDailyEvents } = require("../jobs/dailyEvents");
const { generateMonthlyInvoices } = require("../jobs/monthlyInvoices");
const { processWebhookQueue } = require("../lib/webhooks");
const { processEmailQueue } = require("../lib/mailer");

// Called by Vercel Cron (it sends "Authorization: Bearer $CRON_SECRET"). Not usable without that secret.
const router = express.Router();

function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers.authorization || "");
  const expected = `Bearer ${secret}`;
  const ok = !!secret && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// GET /api/cron/daily — overdue/renewal events, retry queues, and the monthly invoices on the 1st
router.get("/daily", requireCronSecret, async (req, res) => {
  const out = {};
  try { out.events = await runDailyEvents(); } catch (e) { out.events = { error: e.message }; }
  try { out.webhooks = await processWebhookQueue(); } catch (e) { out.webhooks = { error: e.message }; }
  try { out.emails = await processEmailQueue(); } catch (e) { out.emails = { error: e.message }; }
  if (new Date().getUTCDate() === 1 || req.query.monthly === "1") {
    try { out.monthlyInvoices = (await generateMonthlyInvoices()).length; } catch (e) { out.monthlyInvoices = { error: e.message }; }
  }
  res.json({ ok: true, ...out });
});

// GET /api/cron/queues — only the retry queues (use it as a frequent cron on paid plans)
router.get("/queues", requireCronSecret, async (req, res) => {
  const out = {};
  try { out.webhooks = await processWebhookQueue(); } catch (e) { out.webhooks = { error: e.message }; }
  try { out.emails = await processEmailQueue(); } catch (e) { out.emails = { error: e.message }; }
  res.json({ ok: true, ...out });
});

module.exports = router;
