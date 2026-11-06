const test = require("node:test");
const assert = require("node:assert/strict");
const { cycleMonths, isBillingDue } = require("../src/lib/billing");

const month = (y, m) => new Date(y, m - 1, 1); // m is 1-based

test("cycleMonths maps renewal cycles; 'once' is never billed", () => {
  assert.equal(cycleMonths("monthly"), 1);
  assert.equal(cycleMonths("quarterly"), 3);
  assert.equal(cycleMonths("yearly"), 12);
  assert.equal(cycleMonths("once"), null);
  assert.equal(cycleMonths(undefined), null);
});

test("monthly clients are billed every month after their anchor", () => {
  const c = { renewal_cycle: "monthly", contract_start: "2026-01-15" };
  assert.equal(isBillingDue(c, month(2026, 1)), true);
  assert.equal(isBillingDue(c, month(2026, 7)), true);
});

test("quarterly clients are billed only every 3rd month", () => {
  const c = { renewal_cycle: "quarterly", contract_start: "2026-01-10" };
  assert.equal(isBillingDue(c, month(2026, 1)), true);
  assert.equal(isBillingDue(c, month(2026, 2)), false);
  assert.equal(isBillingDue(c, month(2026, 3)), false);
  assert.equal(isBillingDue(c, month(2026, 4)), true);
});

test("yearly clients are billed only on the anniversary month", () => {
  const c = { renewal_cycle: "yearly", contract_start: "2025-03-01" };
  assert.equal(isBillingDue(c, month(2026, 3)), true);
  assert.equal(isBillingDue(c, month(2026, 4)), false);
});

test("contract_end takes priority over contract_start as the anchor", () => {
  const c = { renewal_cycle: "quarterly", contract_start: "2026-01-01", contract_end: "2026-02-20" };
  assert.equal(isBillingDue(c, month(2026, 2)), true);
  assert.equal(isBillingDue(c, month(2026, 5)), true);
  assert.equal(isBillingDue(c, month(2026, 4)), false);
});

test("never billed before the anchor month, without an anchor, or for 'once'", () => {
  assert.equal(isBillingDue({ renewal_cycle: "monthly", contract_start: "2026-06-01" }, month(2026, 5)), false);
  assert.equal(isBillingDue({ renewal_cycle: "monthly" }, month(2026, 5)), false);
  assert.equal(isBillingDue({ renewal_cycle: "once", contract_start: "2026-01-01" }, month(2026, 5)), false);
});
