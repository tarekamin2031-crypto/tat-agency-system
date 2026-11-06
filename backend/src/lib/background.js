// Work that must finish AFTER the HTTP response was sent (audit rows, webhook/email deliveries).
// On a normal server the promise simply runs. On Vercel the function is frozen once the response is sent,
// so the promise is handed to waitUntil() to keep the invocation alive until it settles.
let waitUntil = null;
if (process.env.VERCEL) {
  try { ({ waitUntil } = require("@vercel/functions")); } catch { /* package missing: behave like a normal server */ }
}

function background(promise) {
  const p = Promise.resolve(promise).catch((err) => console.error("[background]", err && err.message));
  if (waitUntil) { try { waitUntil(p); } catch { /* not inside a request context */ } }
  return promise;
}

module.exports = { background };
