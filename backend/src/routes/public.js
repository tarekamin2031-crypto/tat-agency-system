const express = require("express");
const { validateLead, saveLead, notifyLead } = require("../lib/leads");
const { audit } = require("../lib/audit");
const { background } = require("../lib/background");

// Public (no sign-in) endpoints used by the marketing landing page.
const router = express.Router();

// Per-IP throttle: 5 submissions / hour (separate from the login limiter, which keys on email).
const hits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, 10 * 60 * 1000).unref();
function contactLimiter(req, res, next) {
  const now = Date.now();
  let e = hits.get(req.ip);
  if (!e || e.reset <= now) e = { count: 0, reset: now + 60 * 60 * 1000 };
  e.count += 1;
  hits.set(req.ip, e);
  if (e.count > 5) {
    res.setHeader("Retry-After", Math.ceil((e.reset - now) / 1000));
    return res.status(429).json({ error: "محاولات كتير، حاول تاني بعد شوية" });
  }
  next();
}

// POST /api/public/contact
router.post("/contact", contactLimiter, async (req, res) => {
  // honeypot: real people never fill the hidden "website" field — pretend success, store nothing
  if (req.body && req.body.website) return res.status(201).json({ ok: true });
  const { value, error } = validateLead(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const id = await saveLead(value, req);
    audit(null, { action: "lead.create", entity: "lead", entityId: id, agencyId: null, user: { name: value.name, email: value.email }, summary: `${value.name} (${value.interest})` });
    background(notifyLead(value)); // after the response
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error saving your message" });
  }
});

module.exports = router;
