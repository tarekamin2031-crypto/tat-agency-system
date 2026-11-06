const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { encrypt, decrypt, sha256 } = require("../src/lib/secrets");
const { render } = require("../src/lib/emailTemplates");
const { sign, isPrivateIp, assertSafeUrl, newSecret, EVENTS, fillTemplate, buildMessage, maskUrl } = require("../src/lib/webhooks");

test("secrets: encrypt/decrypt round-trips and never stores plaintext", () => {
  const blob = encrypt("smtp-pass-123");
  assert.ok(!blob.includes("smtp-pass-123"));
  assert.equal(decrypt(blob), "smtp-pass-123");
  assert.equal(encrypt(""), null);
  assert.equal(decrypt("garbage"), null);
  assert.equal(sha256("a").length, 64);
});

test("email templates: every template renders in both languages with the right direction", () => {
  const v = { name: "Sara", url: "https://x.test/reset?token=abc", number: "INV-1", amount: "100 EGP", due: "2026-01-01", client: "Acme", items: ["INV-1 — Acme"] };
  for (const lang of ["ar", "en"]) {
    for (const tpl of ["welcome", "reset", "reminder", "payment", "overdue", "test"]) {
      const r = render(tpl, lang, v, "Brand");
      assert.ok(r.subject && r.html && r.text, `${tpl}/${lang}`);
      assert.match(r.html, lang === "ar" ? /dir="rtl"/ : /dir="ltr"/);
    }
  }
  assert.ok(render("reset", "en", v).text.includes("https://x.test/reset?token=abc"));
  assert.match(render("reminder", "en", v).subject, /Payment reminder/);
  assert.throws(() => render("nope", "en", v));
});

test("email templates: user-supplied text is HTML-escaped", () => {
  const r = render("reminder", "en", { name: "<script>x</script>", number: "1", amount: "1" }, "<b>Co</b>");
  assert.ok(!r.html.includes("<script>") && !r.html.includes("<b>Co</b>"));
});

test("webhooks: signature is HMAC-SHA256 over timestamp.body", () => {
  const sig = sign("secret", 1700000000, '{"a":1}');
  assert.equal(sig, crypto.createHmac("sha256", "secret").update('1700000000.{"a":1}').digest("hex"));
  assert.notEqual(sig, sign("other", 1700000000, '{"a":1}'));
  assert.match(newSecret(), /^whsec_[0-9a-f]{48}$/);
  assert.ok(EVENTS.includes("invoice.paid"));
});

test("webhooks: private and internal addresses are blocked", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.ok(!isPrivateIp(ip), ip);
  const old = process.env.WEBHOOK_ALLOW_PRIVATE;
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
  try {
    await assert.rejects(() => assertSafeUrl("http://127.0.0.1/hook"));
    await assert.rejects(() => assertSafeUrl("http://169.254.169.254/latest/meta-data"));
    await assert.rejects(() => assertSafeUrl("ftp://example.com/x"));
    await assert.rejects(() => assertSafeUrl("https://user:pw@8.8.8.8/x"));
    await assert.doesNotReject(() => assertSafeUrl("https://8.8.8.8/hook"));
  } finally {
    if (old !== undefined) process.env.WEBHOOK_ALLOW_PRIVATE = old;
  }
});

test("webhooks: default messages exist for every event in both languages", () => {
  const data = { number: "INV-9", client_name: "Acme", amount: 1500, currency: "EGP", name: "Acme", days_overdue: 3, days_left: 5, payment_amount: 200 };
  for (const ev of [...EVENTS, "webhook.test"]) {
    for (const lang of ["ar", "en"]) assert.ok(buildMessage(ev, data, lang).length > 5, `${ev}/${lang}`);
  }
  assert.equal(buildMessage("invoice.paid", data, "en"), "✅ Invoice INV-9 paid — Acme — 1,500 EGP");
  assert.equal(buildMessage("invoice.created", { number: "X", amount: 5, currency: "EGP" }, "en"), "🧾 New invoice X — 5 EGP"); // no dangling dashes
  assert.equal(buildMessage("invoice.paid", data, "en", "Paid {{number}} by {{client_name}}"), "Paid INV-9 by Acme");
});

test("webhooks: placeholders are URL-encoded in URLs and left raw in text", () => {
  const url = "https://api.telegram.org/bot1:AB/sendMessage?chat_id=-100&text={{message}}";
  assert.equal(fillTemplate(url, { message: "a b&c=d?" }, true), "https://api.telegram.org/bot1:AB/sendMessage?chat_id=-100&text=a%20b%26c%3Dd%3F");
  assert.equal(fillTemplate("{{data.number}} / {{number}} / {{missing}}", { number: "7" }), "7 / 7 / ");
});

test("webhooks: Telegram bot tokens are masked", () => {
  assert.equal(maskUrl("https://api.telegram.org/bot123456:AA-bb_cc/sendMessage?chat_id=5"), "https://api.telegram.org/bot***/sendMessage?chat_id=5");
  assert.equal(maskUrl("https://x.test/hook?token=abc123&a=1"), "https://x.test/hook?token=***&a=1");
});
