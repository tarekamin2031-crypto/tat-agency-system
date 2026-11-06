const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeInvoicePayment } = require("../src/lib/invoicePayment");

test("status 'paid' with nothing collected fills paid_amount with the full amount", () => {
  assert.deepEqual(normalizeInvoicePayment({ amount: 5000, paid_amount: 0, status: "paid" }), { paid_amount: 5000, status: "paid" });
});

test("collecting the full amount marks the invoice paid", () => {
  assert.deepEqual(normalizeInvoicePayment({ amount: "5000", paid_amount: "5000", status: "sent" }), { paid_amount: 5000, status: "paid" });
});

test("partial payment keeps the status and amount as entered", () => {
  assert.deepEqual(normalizeInvoicePayment({ amount: 5000, paid_amount: 2000, status: "sent" }), { paid_amount: 2000, status: "sent" });
});

test("overpayment is kept; zero-amount drafts are not auto-paid", () => {
  assert.equal(normalizeInvoicePayment({ amount: 100, paid_amount: 150, status: "paid" }).paid_amount, 150);
  assert.deepEqual(normalizeInvoicePayment({ amount: 0, paid_amount: 0, status: "draft" }), { paid_amount: 0, status: "draft" });
});
