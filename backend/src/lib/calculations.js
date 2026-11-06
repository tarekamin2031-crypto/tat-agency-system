// Pure business-logic helpers (no DB, no Express) so they can be unit-tested.

// Shared health-score formula — used by BOTH /client-health and /alerts so
// the two endpoints can never disagree about which clients are "at risk".
function computeHealthScore(client, invoices, avgRevenue, todayISO) {
  const revenue = invoices.reduce((s, i) => s + Number(i.amount), 0);
  const cashCollected = invoices.reduce((s, i) => s + Number(i.paid_amount), 0);
  const outstandingBalance = revenue - cashCollected;

  let maxDaysOverdue = 0;
  invoices.forEach((i) => {
    const remaining = Number(i.amount) - Number(i.paid_amount);
    if (remaining > 0 && i.due_date) {
      const dueDateStr = i.due_date.toISOString().slice(0, 10);
      if (dueDateStr < todayISO) {
        const days = Math.round((new Date(todayISO) - new Date(dueDateStr)) / 86400000);
        if (days > maxDaysOverdue) maxDaysOverdue = days;
      }
    }
  });

  const paymentScore = revenue > 0 ? Math.min(30, (cashCollected / revenue) * 30) : 30;
  const outstandingRatio = revenue > 0 ? outstandingBalance / revenue : 0;
  const outstandingScore = Math.max(0, 20 - Math.min(1, outstandingRatio) * 20);
  const overdueScore = Math.max(0, 20 - Math.min(180, maxDaysOverdue) / 180 * 20);

  let tenureScore = 0;
  if (client.contract_start) {
    const months = Math.max(0, (new Date(todayISO) - new Date(client.contract_start)) / (1000 * 60 * 60 * 24 * 30));
    tenureScore = Math.min(10, months);
  }
  const valueScore = avgRevenue > 0 ? Math.min(10, (revenue / avgRevenue) * 5) : 5;
  let statusScore = 0;
  if (client.status === "Active") statusScore = 10;
  else if (client.status === "Suspended") statusScore = 5;

  const totalScore = Math.round(paymentScore + outstandingScore + overdueScore + tenureScore + valueScore + statusScore);
  const clamped = Math.max(0, Math.min(100, totalScore));

  let category;
  if (clamped >= 80) category = "Healthy";
  else if (clamped >= 50) category = "NeedsAttention";
  else category = "AtRisk";

  return {
    score: clamped, category,
    breakdown: {
      paymentScore: Math.round(paymentScore), outstandingScore: Math.round(outstandingScore),
      overdueScore: Math.round(overdueScore), tenureScore: Math.round(tenureScore),
      valueScore: Math.round(valueScore), statusScore,
    },
    revenue, cashCollected, outstandingBalance, maxDaysOverdue,
  };
}

// Cash-basis profit summary used by GET /api/finance/summary.
//   netProfit            = cash collected - business expenses
//   profitAfterPersonal  = netProfit - CEO personal expenses
//   cashAvailable        = income - business - personal expenses
// where income = cash collected on invoices + ad-budget commission (the
// agency's cut of client ad spend is the agency's own income).
function computeProfitSummary({ revenue, cashCollected, outstandingBalance, totalExpenses, personalExpenses, adCommission = 0 }) {
  const totalIncome = cashCollected + adCommission;
  const netProfit = totalIncome - totalExpenses;
  const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
  const profitAfterPersonal = netProfit - personalExpenses;
  const cashAvailable = totalIncome - totalExpenses - personalExpenses;
  return { revenue, cashCollected, adCommission, totalIncome, outstandingBalance, totalExpenses, personalExpenses, netProfit, profitMargin, profitAfterPersonal, cashAvailable };
}

module.exports = { computeHealthScore, computeProfitSummary };
