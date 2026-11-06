const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDateRange } = require("../src/utils/dateRange");

test.beforeEach((t) => t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 4, 15, 12) })); // 15 May 2026

test("this_month runs from the 1st to today", () => {
  assert.deepEqual(resolveDateRange("this_month"), { from: "2026-05-01", to: "2026-05-15" });
});

test("last_month covers the whole previous month", () => {
  assert.deepEqual(resolveDateRange("last_month"), { from: "2026-04-01", to: "2026-04-30" });
});

test("this_quarter starts at the quarter's first month", () => {
  assert.deepEqual(resolveDateRange("this_quarter"), { from: "2026-04-01", to: "2026-05-15" });
});

test("last_year is the previous calendar year", () => {
  assert.deepEqual(resolveDateRange("last_year"), { from: "2025-01-01", to: "2025-12-31" });
});

test("custom passes dates through; all/unknown means no filter", () => {
  assert.deepEqual(resolveDateRange("custom", "2026-01-01", "2026-02-01"), { from: "2026-01-01", to: "2026-02-01" });
  assert.deepEqual(resolveDateRange("all"), { from: null, to: null });
  assert.deepEqual(resolveDateRange("nonsense"), { from: null, to: null });
});
