// Lightweight, dependency-free hardening: security headers + login throttling.

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

// In-memory limiter: max `limit` attempts per `windowMs` per key (IP + email).
function createRateLimiter({ limit = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return function rateLimit(req, res, next) {
    const key = `${req.ip}|${String((req.body && req.body.email) || "").toLowerCase()}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) entry = { count: 0, reset: now + windowMs };
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > limit) {
      res.setHeader("Retry-After", Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: "محاولات كتير، حاول تاني بعد شوية" });
    }
    next();
  };
}

module.exports = { securityHeaders, createRateLimiter };
