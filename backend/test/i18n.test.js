const test = require("node:test");
const assert = require("node:assert/strict");
const { buildInvoiceHtml } = require("../src/pdf/invoiceTemplate");
const { sanitizePreferences } = require("../src/lib/settingsValidation");

const invoice = { number: "INV-1", amount: 500, currency: "EGP", issue_date: "2026-01-05", due_date: "2026-02-05", status: "paid" };

test("invoice PDF: Arabic is right-to-left with Arabic labels", () => {
  const html = buildInvoiceHtml(invoice, null, { company: { name: "Co" }, lang: "ar" });
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.ok(html.includes("تاريخ الاستحقاق") && html.includes("مدفوعة") && html.includes("يناير"));
});

test("invoice PDF: English is left-to-right with English labels and month names", () => {
  const html = buildInvoiceHtml(invoice, null, { company: { name: "Co" }, lang: "en" });
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.ok(html.includes("Due date") && html.includes("Paid") && html.includes("January") && html.includes("Bill to"));
  assert.ok(!html.includes("تاريخ الاستحقاق"));
});

test("invoice PDF: unknown language falls back to Arabic", () => {
  assert.match(buildInvoiceHtml(invoice, null, { lang: "fr" }), /lang="ar" dir="rtl"/);
});

test("preferences: language is whitelisted", () => {
  assert.equal(sanitizePreferences({ language: "en" }).language, "en");
  assert.equal(sanitizePreferences({ language: "ar" }).language, "ar");
  assert.equal(sanitizePreferences({ language: "fr" }).language, undefined);
});

test("leads: validation accepts a good request and cleans the input", () => {
  const { validateLead } = require("../src/lib/leads");
  const ok = validateLead({ name: "  Sara  ", email: "sara@example.com", phone: "+20 100 1234567", message: "hi", team_size: "6-15", interest: "pricing", lang: "en", evil: "x" });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.value, { name: "Sara", email: "sara@example.com", phone: "+20 100 1234567", company: null, team_size: "6-15", interest: "pricing", message: "hi", lang: "en" });
  // unknown enum values fall back instead of being stored
  const odd = validateLead({ name: "Sara", email: "sara@example.com", message: "x", team_size: "huge", interest: "hack", lang: "fr" }).value;
  assert.equal(odd.team_size, null); assert.equal(odd.interest, "demo"); assert.equal(odd.lang, "ar");
});

test("leads: validation rejects bad input", () => {
  const { validateLead } = require("../src/lib/leads");
  for (const bad of [{}, { name: "A", email: "a@b.co", message: "x" }, { name: "Sara", email: "nope", message: "x" }, { name: "Sara", email: "a@b.co" }, { name: "Sara", email: "a@b.co", phone: "abc", message: "x" }]) {
    assert.ok(validateLead(bad).error, JSON.stringify(bad));
  }
  assert.equal(validateLead({ name: "Sara", email: "a@b.co", message: "x".repeat(5000) }).value.message.length, 3000);
});

test("emails: lead templates render in both languages and escape input", () => {
  const { render } = require("../src/lib/emailTemplates");
  const n = render("lead_notice", "ar", { name: "S", email: "s@x.co", message: "<script>1</script>" }, "P");
  assert.ok(n.html.includes("&lt;script&gt;") && !n.html.includes("<script>"));
  assert.equal(render("lead_ack", "en", { name: "S" }).subject, "We got your message");
  assert.ok(render("lead_ack", "ar", { name: "S" }).html.includes("dir=\"rtl\""));
});
