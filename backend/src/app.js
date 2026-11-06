require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const clientRoutes = require("./routes/clients");
const invoiceRoutes = require("./routes/invoices");
const expenseRoutes = require("./routes/expenses");
const collectionRoutes = require("./routes/collection");
const adBudgetRoutes = require("./routes/adBudgets");
const serviceRoutes = require("./routes/services");
const financeRoutes = require("./routes/finance");
const settingsRoutes = require("./routes/settings");
const roleRoutes = require("./routes/roles");
const logRoutes = require("./routes/logs");
const platformRoutes = require("./routes/platform");
const emailRoutes = require("./routes/email");
const webhookRoutes = require("./routes/webhooks");
const publicRoutes = require("./routes/public");
const cronRoutes = require("./routes/cron");
const { securityHeaders } = require("./middleware/security");

// The Express app only (no listen, no timers) so it can run both as a long-lived server (Docker/Render/VPS)
// and as a serverless function (Vercel: backend/api/index.js).
// One failing request / background job must never take the whole server down.
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind the nginx container
app.use(securityHeaders);
// CORS_ORIGIN may be a comma-separated allow-list. Unset keeps the previous
// permissive behaviour (the frontend normally talks to /api through nginx).
const corsOrigins = (process.env.CORS_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
// 8mb: invoice receipts, salary screenshots, avatars and the company logo are sent as base64.
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/collection", collectionRoutes);
app.use("/api/ad-budgets", adBudgetRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/cron", cronRoutes);

// generic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error" });
});

module.exports = app;
