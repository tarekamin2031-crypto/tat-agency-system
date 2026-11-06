const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizePreferences, validateNewPassword, parseImageUpload, validateEmail, sanitizeCompany } = require("../src/lib/settingsValidation");

test("preferences: keeps known keys with allowed values, drops everything else", () => {
  const out = sanitizePreferences({
    theme: "light", sidebar: "collapsed", startPage: "/invoices", evil: "<script>",
    defaultFilters: { dateRange: "last_month", clientStatus: "all", hack: 1 },
  });
  assert.deepEqual(out, { theme: "light", sidebar: "collapsed", startPage: "/invoices", defaultFilters: { dateRange: "last_month", clientStatus: "all" } });
});

test("preferences: rejects invalid values and non-objects", () => {
  assert.deepEqual(sanitizePreferences({ theme: "neon", sidebar: 3, startPage: "/admin", defaultFilters: { dateRange: "forever" } }), {});
  assert.deepEqual(sanitizePreferences(null), {});
  assert.deepEqual(sanitizePreferences("x"), {});
});

test("password: length, letters+digits, and must differ from the current one", () => {
  assert.ok(validateNewPassword("short1", "old"));
  assert.ok(validateNewPassword("onlyletters", "old"));
  assert.ok(validateNewPassword("12345678", "old"));
  assert.ok(validateNewPassword("Same-pass1", "Same-pass1"));
  assert.equal(validateNewPassword("Fresh-pass1", "Old-pass1"), null);
  assert.equal(validateNewPassword("كلمة-سر-قوية9", "x"), null);
});

test("image upload: accepts small PNG/JPG/WebP data URLs only", () => {
  const png = "data:image/png;base64," + Buffer.from("fakepng").toString("base64");
  assert.equal(parseImageUpload(png, 1000).mime, "image/png");
  assert.ok(parseImageUpload("data:image/gif;base64,AAAA", 1000).error);
  assert.ok(parseImageUpload("data:image/svg+xml;base64,AAAA", 1000).error);
  assert.ok(parseImageUpload("not a data url", 1000).error);
  assert.ok(parseImageUpload(png, 3).error);
});

test("email validation", () => {
  assert.equal(validateEmail("a@b.co"), true);
  assert.equal(validateEmail("a b@c.com"), false);
  assert.equal(validateEmail("nope"), false);
});

test("company: validates name, commission range, invoice prefix and email", () => {
  assert.ok(sanitizeCompany({ name: "  " }).error);
  assert.ok(sanitizeCompany({ default_commission_rate: 101 }).error);
  assert.ok(sanitizeCompany({ default_commission_rate: "abc" }).error);
  assert.ok(sanitizeCompany({ invoice_prefix: "bad prefix" }).error);
  assert.ok(sanitizeCompany({ email: "x" }).error);
  const ok = sanitizeCompany({ name: " TAT ", default_commission_rate: "15.555", invoice_prefix: "tat", email: "hi@tat.com", phone: "" });
  assert.deepEqual(ok.values, { name: "TAT", default_commission_rate: 15.56, invoice_prefix: "TAT", email: "hi@tat.com", phone: null });
});

test("preferences: dashboard widgets are whitelisted and de-duplicated (empty list allowed)", () => {
  assert.deepEqual(sanitizePreferences({ dashboardWidgets: ["kpis", "trend", "kpis", "evil", 5] }).dashboardWidgets, ["kpis", "trend"]);
  assert.deepEqual(sanitizePreferences({ dashboardWidgets: [] }).dashboardWidgets, []);
  assert.equal("dashboardWidgets" in sanitizePreferences({ dashboardWidgets: "kpis" }), false);
});
