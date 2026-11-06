// Reconciliation audit: asks a RUNNING backend for the same figures through
// different endpoints (with many filter combinations) and checks they agree.
// Read-only. Usage:
//   API_URL=http://localhost:4000/api AUDIT_EMAIL=admin@x.com AUDIT_PASSWORD=... npm run audit
const B = process.env.API_URL || "http://localhost:4000/api";
const j = (r) => r.json();
const login = await fetch(`${B}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.AUDIT_EMAIL, password: process.env.AUDIT_PASSWORD }) }).then(j);
const H = { Authorization: `Bearer ${login.token}` };
const g = (p) => fetch(`${B}${p}`, { headers: H }).then(j);
const clients = await g("/clients");
const services = await g("/services");
const n = (x) => Math.round(Number(x) * 100) / 100;
const sum = (a, f) => n(a.reduce((s, r) => s + Number(f(r)), 0));
const results = []; let bad = 0;
const check = (name, a, b, ctx) => { const ok = Math.abs(a - b) < 0.011; if (!ok) bad++; results.push({ ok, name, a, b, ctx }); };

const combos = [];
for (const date_range of ["all", "this_month", "last_month", "this_year"])
  for (const client_status of ["all", "Active"])
    for (const client_id of ["all", String(clients[0].id)])
      for (const service_id of ["all", String(services[0].id)])
        combos.push({ date_range, client_status, client_id, service_id });

for (const c of combos) {
  const q = new URLSearchParams(c).toString();
  const ctx = JSON.stringify(c);
  const sm = await g(`/finance/summary?${q}`);
  const inv = await g(`/invoices?${q}`);
  check("summary.revenue == invoices list", sm.revenue, sum(inv, (i) => i.amount), ctx);
  check("summary.cash == invoices list paid", sm.cashCollected, sum(inv, (i) => i.paid_amount), ctx);
  check("summary.outstanding == revenue-cash", sm.outstandingBalance, n(sm.revenue - sm.cashCollected), ctx);
  check("net = cash+ad-expenses", sm.netProfit, n(sm.cashCollected + sm.adCommission - sm.totalExpenses), ctx);
  const ads = await g(`/ad-budgets?${new URLSearchParams({ client_id: c.client_id, client_status: c.client_status, date_range: c.date_range }).toString()}`);
  const adsList = Array.isArray(ads) ? ads : ads.entries || [];
  if (c.service_id === "all") check("summary.adCommission == ad-budgets list", sm.adCommission, sum(adsList, (a) => a.commission_amount), ctx);
  const bs = await g(`/finance/by-service?${q}`);
  if (c.service_id === "all") {
    check("by-service revenue == summary", sum(bs, (r) => r.revenue), sm.revenue, ctx);
    check("by-service cash == summary", sum(bs, (r) => r.cashCollected), sm.cashCollected, ctx);
    check("by-service adCommission == summary", sum(bs, (r) => r.adCommission || 0), sm.adCommission, ctx);
    check("by-service expenses == summary", sum(bs, (r) => r.expenses), sm.totalExpenses, ctx);
    check("by-service net == summary", sum(bs, (r) => r.netProfit), sm.netProfit, ctx);
    const cp = await g(`/finance/client-profitability?${q}`);
    check("client-profitability revenue == summary", sum(cp, (r) => r.revenue), sm.revenue, ctx);
    check("client-profitability cash == summary", sum(cp, (r) => r.cashCollected), sm.cashCollected, ctx);
  }
  const pc = await g(`/finance/payment-center?${q}`);
  check("payment-center required == summary.revenue", sum(pc, (r) => r.required_amount), sm.revenue, ctx);
}
// unfiltered global ties
const q0 = "date_range=all&client_status=all&client_id=all&service_id=all";
const s0 = await g(`/finance/summary?${q0}`);
const tr = await g("/finance/monthly-trend?client_status=all");
check("monthly-trend revenue(12m) == summary(all)", sum(tr, (r) => r.revenue), s0.revenue, "all");
check("monthly-trend net(12m) == summary(all)", sum(tr, (r) => r.netProfit), s0.netProfit, "all");
const col = await g("/collection");
const invAll = await g("/invoices");
const linked = col.filter((e) => e.invoice_id);
const unpaid = invAll.filter((i) => i.status !== "draft" && Number(i.amount) > Number(i.paid_amount));
check("every unpaid issued invoice has a collection entry", unpaid.filter((i) => linked.some((e) => e.invoice_id === i.id)).length, unpaid.length, "all");
check("linked collection paid == invoice paid", sum(linked, (e) => e.amount_paid), sum(linked.map((e) => invAll.find((i) => i.id === e.invoice_id)).filter(Boolean), (i) => i.paid_amount), "all");

const fails = results.filter((r) => !r.ok);
const byName = {};
fails.forEach((f) => { (byName[f.name] ||= []).push(f); });
console.log(`checks: ${results.length}, failed: ${bad}`);
for (const [name, list] of Object.entries(byName)) {
  console.log(`\n✗ ${name}  (${list.length} combos)`);
  list.slice(0, 2).forEach((f) => console.log(`    a=${f.a} b=${f.b}  ${f.ctx}`));
}
