// Long-running entry point (Docker / Render / VPS): HTTP server + in-process schedulers.
// On Vercel the same app is exposed through api/index.js and the schedulers are replaced by Vercel Cron (/api/cron/daily).
const cron = require("node-cron");
const app = require("./app");
const { generateMonthlyInvoices } = require("./jobs/monthlyInvoices");
const { runDailyEvents } = require("./jobs/dailyEvents");
const { processWebhookQueue } = require("./lib/webhooks");
const { processEmailQueue } = require("./lib/mailer");

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`TAT Agency backend listening on port ${PORT}`);
});

// Runs at 00:05 on the 1st of every month (container's local time — UTC by
// default in Docker). Auto-generates that month's invoice for every active
// client whose renewal cycle says a bill is due, skipping anyone already
// billed for the month.
cron.schedule("5 0 1 * *", () => {
  generateMonthlyInvoices()
    .then((created) => console.log(`[monthly-invoices] Generated ${created.length} invoice(s).`))
    .catch((err) => console.error("[monthly-invoices] Failed:", err));
});

// 07:00 every day: announce newly overdue invoices and renewals due within a week
// (webhooks + optional admin email digest). Each entity is announced only once.
cron.schedule("0 7 * * *", () => {
  runDailyEvents()
    .then((r) => console.log("[daily-events]", JSON.stringify(r)))
    .catch((err) => console.error("[daily-events] Failed:", err));
});

// Retry workers: failed webhook deliveries and queued emails are re-attempted with backoff.
setInterval(() => {
  processWebhookQueue().catch((err) => console.error("[webhooks] queue:", err.message));
  processEmailQueue().catch((err) => console.error("[mailer] queue:", err.message));
}, 30 * 1000).unref();
