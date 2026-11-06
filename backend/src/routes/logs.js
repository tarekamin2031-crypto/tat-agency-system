const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { queryLogs, logFilterOptions } = require("../lib/logQuery");

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission("logs", "view"));

// GET /api/logs — the caller's own agency only (the platform-wide view lives under /api/platform/logs)
// Query: user_id, entity, entity_id, action, from, to, q, page, limit
router.get("/", async (req, res) => {
  const { page, limit, ...filters } = req.query;
  delete filters.agency_id; // an agency can never widen its scope
  try {
    res.json(await queryLogs({ agencyId: req.user.agencyId, filters, page, limit }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error loading logs" });
  }
});

// GET /api/logs/filters — values for the filter dropdowns
router.get("/filters", async (req, res) => {
  try {
    res.json(await logFilterOptions({ agencyId: req.user.agencyId }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error loading log filters" });
  }
});

module.exports = router;
