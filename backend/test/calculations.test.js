const test = require("node:test");
const assert = require("node:assert/strict");
const { computeHealthScore, computeProfitSummary } = require("../src/lib/calculations");

test("profit summary: cash-basis net profit, margin, personal draws", () => {
  const s = computeProfitSummary({ revenue: 100000, cashCollected: 80000, outstandingBalance: 20000, totalExpenses: 30000, personalExpenses: 10000 });
  assert.equal(s.netProfit, 50000);
  assert.equal(s.profitMargin, 62.5);
  assert.equal(s.profitAfterPersonal, 40000);
  assert.equal(s.cashAvailable, 40000);
});

test("profit summary: no cash collected gives 0% margin and a loss", () => {
  const s = computeProfitSummary({ revenue: 5000, cashCollected: 0, outstandingBalance: 5000, totalExpenses: 2000, personalExpenses: 0 });
  assert.equal(s.profitMargin, 0);
  assert.equal(s.netProfit, -2000);
});

const client = { contract_start: "2020-01-01", status: "Active" };
const inv = (amount, paid, due) => ({ amount, paid_amount: paid, due_date: due ? new Date(due) : null });

test("health score: fully paid long-standing active client is Healthy", () => {
  const h = computeHealthScore(client, [inv(1000, 1000, "2026-01-01")], 1000, "2026-06-01");
  assert.equal(h.category, "Healthy");
  assert.equal(h.outstandingBalance, 0);
  assert.equal(h.maxDaysOverdue, 0);
  assert.ok(h.score >= 80 && h.score <= 100);
});

test("health score: long-overdue unpaid invoice drops the client to AtRisk", () => {
  const h = computeHealthScore({ ...client, status: "Stopped" }, [inv(1000, 0, "2025-01-01")], 1000, "2026-06-01");
  assert.equal(h.category, "AtRisk");
  assert.equal(h.outstandingBalance, 1000);
  assert.ok(h.maxDaysOverdue > 180);
  assert.ok(h.breakdown.overdueScore === 0);
});

test("health score: stays within 0..100 and ignores not-yet-due balances", () => {
  const h = computeHealthScore(client, [inv(1000, 0, "2099-01-01")], 0, "2026-06-01");
  assert.equal(h.maxDaysOverdue, 0);
  assert.ok(h.score >= 0 && h.score <= 100);
});

test("profit summary: ad-budget commission counts as company income", () => {
  const s = computeProfitSummary({ revenue: 100000, cashCollected: 80000, adCommission: 6000, outstandingBalance: 20000, totalExpenses: 30000, personalExpenses: 10000 });
  assert.equal(s.totalIncome, 86000);
  assert.equal(s.netProfit, 56000);
  assert.equal(s.profitAfterPersonal, 46000);
  assert.equal(s.cashAvailable, 46000);
  assert.ok(Math.abs(s.profitMargin - (56000 / 86000) * 100) < 1e-9);
});

test("profit summary: commission alone (no invoice cash) still yields a profit", () => {
  const s = computeProfitSummary({ revenue: 0, cashCollected: 0, adCommission: 4000, outstandingBalance: 0, totalExpenses: 1000, personalExpenses: 0 });
  assert.equal(s.netProfit, 3000);
  assert.equal(s.profitMargin, 75);
});
