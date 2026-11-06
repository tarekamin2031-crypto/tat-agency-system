import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../api/client";
import { NAVY, NAVY_SOFT, GOLD, TEAL, RED, GREEN, formatMoney, btnStyle, INK, tint } from "../theme";
import { GroupedBarChart, Legend, StackedFlowChart, HalfDonut } from "../components/Charts";
import { EmptyBox, StatCard, FilterPills, LoadingBox } from "../components/Bits";
import Icon from "../components/Icons";
import { t, MONTHS } from "../i18n";

const MONTHS_AR = MONTHS;
function monthLabel(key) {
  if (!key) return "—";
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}
const DONUT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const DATE_RANGE_OPTIONS = [
  { id: "this_month", get label() { return t("هذا الشهر"); } },
  { id: "last_month", get label() { return t("الشهر الماضي"); } },
  { id: "this_quarter", get label() { return t("هذا الربع"); } },
  { id: "this_year", get label() { return t("هذا العام"); } },
  { id: "last_year", get label() { return t("العام الماضي"); } },
  { id: "all", get label() { return t("كل الوقت"); } },
];

function growthPct(rows, key) {
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (!prev || Number(prev[key]) === 0) return null;
  return ((Number(last[key]) - Number(prev[key])) / Number(prev[key])) * 100;
}
function average(rows, key) {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + Number(r[key]), 0) / rows.length;
}
function safeRatio(numerator, denominator) {
  if (!denominator || denominator === 0) return 0;
  return (numerator / denominator) * 100;
}

export default function FinancialAnalyticsTab() {
  const [dateRange, setDateRange] = useState("this_month");
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [byService, setByService] = useState([]);
  const [companyCategories, setCompanyCategories] = useState(null);
  const [personalCategories, setPersonalCategories] = useState(null);
  const [personalExpensesRaw, setPersonalExpensesRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [incomeTab, setIncomeTab] = useState("mix");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const q = `date_range=${dateRange}&client_status=all`;
      const [sum, trendData, services, compCats, persCats, persList] = await Promise.all([
        api.financeSummary(q),
        api.monthlyTrend("client_status=all"), // trend is always last-12-months regardless of the KPI date range
        api.financeByService(q),
        api.expenseCategoriesBreakdown(`expense_type=business&${q}`),
        api.expenseCategoriesBreakdown(`expense_type=personal&${q}`),
        api.listExpenses("expense_type=personal"),
      ]);
      setSummary(sum);
      setTrend(trendData);
      setByService(services.filter((s) => s.revenue > 0 || s.expenses > 0).slice(0, 8));
      setCompanyCategories(compCats);
      setPersonalCategories(persCats);
      setPersonalExpensesRaw(persList);
    } catch (err) {
      setLoadError(err.message || t("تعذر تحميل التحليل المالي"));
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);

  const personalByMonth = useMemo(() => {
    const byMonth = {};
    personalExpensesRaw.forEach((e) => {
      const key = e.date.slice(0, 7);
      byMonth[key] = (byMonth[key] || 0) + Number(e.amount);
    });
    return Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([month, amount]) => ({ month, amount }));
  }, [personalExpensesRaw]);

  const revenueGrowth = growthPct(trend, "revenue");
  const expenseGrowth = growthPct(trend, "expenses");
  const profitGrowth = growthPct(trend, "netProfit");
  const avgRevenue = average(trend, "revenue");
  const avgExpenses = average(trend, "expenses");
  const avgProfit = average(trend, "netProfit");

  const expenseRatio = summary ? safeRatio(summary.totalExpenses, summary.revenue) : 0;
  const personalSpendingRatio = summary ? safeRatio(summary.personalExpenses, summary.netProfit) : 0;


  const growthArrow = (v) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  const growthColor = (v) => (v === null ? "var(--ink-3)" : v >= 0 ? GREEN : RED);

  // ---- chart data ----
  const mixSeries = [
    { key: "collected", get label() { return t("المحصّل"); }, color: "var(--chart-1)" },
    { key: "ad", get label() { return t("عمولة الإعلانات"); }, color: "var(--chart-3)" },
    { key: "out", get label() { return t("المستحق"); }, color: "var(--chart-5)" },
  ];
  const mixData = trend.map((m) => ({
    key: m.month,
    label: MONTHS_AR[Number(m.month.split("-")[1]) - 1],
    parts: { collected: m.cashCollected, ad: m.adCommission || 0, out: Math.max(0, m.revenue - m.cashCollected) },
  }));
  const totalIncome12 = trend.reduce((sum, m) => sum + m.cashCollected + (m.adCommission || 0), 0);
  const netProfit12 = trend.reduce((sum, m) => sum + m.netProfit, 0);
  const personal12 = personalByMonth.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div>
      <div className="tat-fa-head">
        <FilterPills options={DATE_RANGE_OPTIONS} value={dateRange} onChange={setDateRange} />
      </div>

      {loadError && (
        <div className="tat-row" style={{ marginBottom: 16, borderColor: tint(RED, 35) }}>
          <span className="tat-ico" style={{ "--c": RED }}><Icon name="bell" size={19} /></span>
          <div style={{ flex: 1, fontSize: 13 }}>
            {t("تعذر تحميل التحليل المالي:")} {loadError}
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{t("غالبًا السيرفر شغّال بنسخة قديمة من الكود لسه ما اتحدّثتش.")}</div>
          </div>
          <button onClick={load} style={{ ...btnStyle(RED), fontSize: 12 }}>{t("إعادة المحاولة")}</button>
        </div>
      )}

      {loading ? <LoadingBox rows={4} /> : !summary ? null : (
        <>
          <SectionTitle>{t("الملخص المالي")}</SectionTitle>
          <div className="tat-bento tat-rise">
            <div className="span-3"><StatCard icon="banknote" label={t("الإيرادات")} value={formatMoney(summary.revenue, "EGP")} color={TEAL} /></div>
            <div className="span-3"><StatCard icon="megaphone" label={t("عمولة الإعلانات")} value={formatMoney(summary.adCommission, "EGP")} color="var(--orange)" /></div>
            <div className="span-3"><StatCard icon="receipt" label={t("مصاريف الشركة")} value={formatMoney(summary.totalExpenses, "EGP")} color={RED} /></div>
            <div className="span-3"><StatCard icon="trend" label={t("صافي ربح الشركة")} value={formatMoney(summary.netProfit, "EGP")} color={summary.netProfit >= 0 ? GREEN : RED} /></div>
            <div className="span-4"><StatCard icon="wallet" label={t("مصاريف CEO الشخصية")} value={formatMoney(summary.personalExpenses, "EGP")} color={GOLD} /></div>
            <div className="span-4"><StatCard icon="checkCircle" label={t("الربح بعد المصاريف الشخصية")} value={formatMoney(summary.profitAfterPersonal, "EGP")} color={summary.profitAfterPersonal >= 0 ? GREEN : RED} /></div>
            <div className="span-4"><StatCard icon="banknote" label={t("رصيد النقدية المتاح")} value={formatMoney(summary.cashAvailable, "EGP")} color={TEAL} /></div>
          </div>

          <SectionTitle>{t("مؤشرات الصحة المالية")}</SectionTitle>
          <div className="tat-bento tat-rise">
            <div className="span-4"><StatCard icon="trend" label={t("هامش الربح")} value={`${summary.profitMargin.toFixed(1)}%`} color={GREEN} /></div>
            <div className="span-4"><StatCard icon="receipt" label={t("نسبة المصاريف")} value={`${expenseRatio.toFixed(1)}%`} color={RED} /></div>
            <div className="span-4"><StatCard icon="wallet" label={t("نسبة المصاريف الشخصية من صافي الربح")} value={summary.netProfit > 0 ? `${personalSpendingRatio.toFixed(1)}%` : "—"} color={GOLD} /></div>
            <div className="span-4"><StatCard icon="trend" label={t("نمو الإيرادات (آخر شهر)")} value={growthArrow(revenueGrowth)} color={growthColor(revenueGrowth)} /></div>
            <div className="span-4"><StatCard icon="trend" label={t("نمو المصاريف (آخر شهر)")} value={growthArrow(expenseGrowth)} color={growthColor(expenseGrowth != null ? -expenseGrowth : null)} /></div>
            <div className="span-4"><StatCard icon="trend" label={t("نمو الربح (آخر شهر)")} value={growthArrow(profitGrowth)} color={growthColor(profitGrowth)} /></div>
            <div className="span-4"><StatCard icon="banknote" label={t("متوسط الإيرادات الشهري")} value={formatMoney(avgRevenue, "EGP")} color={TEAL} /></div>
            <div className="span-4"><StatCard icon="receipt" label={t("متوسط المصاريف الشهري")} value={formatMoney(avgExpenses, "EGP")} color={RED} /></div>
            <div className="span-4"><StatCard icon="checkCircle" label={t("متوسط الربح الشهري")} value={formatMoney(avgProfit, "EGP")} color={GREEN} /></div>
          </div>

          <SectionTitle>{t("الاتجاهات (آخر 12 شهر)")}</SectionTitle>
          <div className="tat-bento tat-rise">
            <div className="span-12">
              <div className="tat-card" style={{ padding: 22 }}>
                <div className="tat-card-head">
                  <div className="tat-card-title"><span className="tat-ico" style={{ "--c": GREEN }}><Icon name="chart" size={17} /></span>{t("نظرة على الدخل")}</div>
                  <div className="tat-seg compact">
                    <button type="button" className={incomeTab === "mix" ? "on" : ""} onClick={() => setIncomeTab("mix")}>{t("تركيب الدخل")}</button>
                    <button type="button" className={incomeTab === "cmp" ? "on" : ""} onClick={() => setIncomeTab("cmp")}>{t("إيرادات ومصاريف")}</button>
                  </div>
                </div>
                {trend.length === 0 ? <EmptyBox>{t("لا توجد بيانات كافية")}</EmptyBox> : incomeTab === "mix" ? (
                  <>
                    <div className="tat-big-row">
                      <div className="tat-num tat-big">{formatMoney(totalIncome12, "EGP")}</div>
                      <span className="tat-big-sub">{t("إجمالي الدخل (محصّل + عمولة إعلانات) خلال")}{" "}{trend.length}{" "}{t("شهر")}</span>
                    </div>
                    <StackedFlowChart data={mixData} series={mixSeries} height={310} />
                    <Legend items={mixSeries.map((x) => ({ color: x.color, label: x.label }))} />
                  </>
                ) : (
                  <>
                    <Legend items={[{ color: "var(--chart-2)", get label() { return t("إيرادات"); } }, { color: "var(--chart-1)", get label() { return t("محصّل"); } }, { color: "var(--red)", get label() { return t("مصاريف الشركة"); } }]} />
                    <GroupedBarChart
                      data={trend.map((m) => ({ ...m, key: m.month, label: MONTHS_AR[Number(m.month.split("-")[1]) - 1] }))}
                      series={[{ key: "revenue", get label() { return t("إيرادات"); }, color: "var(--chart-2)" }, { key: "cashCollected", get label() { return t("محصّل"); }, color: "var(--chart-1)" }, { key: "expenses", get label() { return t("مصاريف الشركة"); }, color: "var(--red)" }]}
                      getValue={(row, s) => row[s.key]}
                    />
                  </>
                )}
              </div>
            </div>

            <div className="span-12">
              <div className="tat-card" style={{ padding: 22 }}>
                <div className="tat-card-head">
                  <div className="tat-card-title"><span className="tat-ico" style={{ "--c": GOLD }}><Icon name="wallet" size={17} /></span>{t("صافي ربح الشركة مقابل المصاريف الشخصية")}</div>
                  <span className="tat-label">{t("آخر 12 شهر")}</span>
                </div>
                {trend.length === 0 ? <EmptyBox>{t("لا توجد بيانات كافية")}</EmptyBox> : (
                  <>
                    <div className="tat-big-row">
                      <div className="tat-num tat-big" style={{ color: netProfit12 >= 0 ? "var(--green)" : "var(--red)" }}>{formatMoney(netProfit12, "EGP")}</div>
                      <span className="tat-big-sub">{t("صافي ربح الشركة · سحوبات CEO الشخصية")}{" "}{formatMoney(personal12, "EGP")}</span>
                    </div>
                    <Legend items={[{ color: "var(--chart-1)", get label() { return t("صافي ربح الشركة"); } }, { color: "var(--chart-5)", get label() { return t("مصاريف شخصية CEO"); } }]} />
                    <GroupedBarChart
                      data={trend.map((m) => ({ ...m, key: m.month, label: MONTHS_AR[Number(m.month.split("-")[1]) - 1], personal: personalByMonth.find((p) => p.month === m.month)?.amount || 0 }))}
                      series={[{ key: "netProfit", get label() { return t("صافي ربح الشركة"); }, color: "var(--chart-1)" }, { key: "personal", get label() { return t("مصاريف شخصية CEO"); }, color: "var(--chart-5)" }]}
                      getValue={(row, s) => row[s.key]}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          <SectionTitle>{t("توزيع المصاريف")}</SectionTitle>
          <div className="tat-bento tat-rise">
            <div className="span-6"><CategoryDonut data={companyCategories} title={t("مصاريف الشركة حسب الفئة")} icon="receipt" color={RED} /></div>
            <div className="span-6"><CategoryDonut data={personalCategories} title={t("المصاريف الشخصية حسب الفئة")} icon="wallet" color={GOLD} /></div>
          </div>

          <SectionTitle>{t("الإيرادات حسب الخدمة")}</SectionTitle>
          <div className="tat-card" style={{ overflow: "hidden", marginBottom: 24 }}>
            {byService.length === 0 ? <EmptyBox>{t("لا توجد بيانات")}</EmptyBox> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <Th>{t("الخدمة")}</Th><Th>{t("الإيرادات")}</Th><Th>{t("صافي الربح")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {byService.map((s, i) => (
                    <tr key={i} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                      <Td style={{ fontWeight: 600 }}>{s.serviceName}</Td>
                      <Td>{formatMoney(s.revenue, "EGP")}</Td>
                      <Td style={{ color: s.netProfit >= 0 ? GREEN : RED }}>{formatMoney(s.netProfit, "EGP")}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <SectionTitle>{t("تحليل النقدية")}</SectionTitle>
          <div className="tat-bento tat-rise">
            <div className="span-3"><StatCard icon="checkCircle" label={t("نقدية داخلة (محصّل)")} value={formatMoney(summary.cashCollected, "EGP")} color={GREEN} /></div>
            <div className="span-3"><StatCard icon="receipt" label={t("نقدية خارجة (مصاريف الشركة)")} value={formatMoney(summary.totalExpenses, "EGP")} color={RED} /></div>
            <div className="span-3"><StatCard icon="wallet" label={t("نقدية خارجة (سحوبات CEO)")} value={formatMoney(summary.personalExpenses, "EGP")} color={GOLD} /></div>
            <div className="span-3"><StatCard icon="banknote" label={t("رصيد النقدية الحالي")} value={formatMoney(summary.cashAvailable, "EGP")} color={TEAL} /></div>
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div className="tat-section-title">{children}</div>;
}
function Th({ children }) { return <th style={{ textAlign: "right", padding: "10px 12px", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children, style }) { return <td style={{ padding: "10px 12px", whiteSpace: "nowrap", ...style }}>{children}</td>; }

// Expenses by category: half donut (top 5 + "others") with a ranked list.
function CategoryDonut({ data, title, icon, color }) {
  const head = (
    <div className="tat-card-head">
      <div className="tat-card-title"><span className="tat-ico" style={{ "--c": color }}><Icon name={icon} size={17} /></span>{title}</div>
    </div>
  );
  if (!data || data.categories.length === 0) {
    return <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>{head}<EmptyBox>{t("لا توجد بيانات")}</EmptyBox></div>;
  }
  const sorted = [...data.categories].sort((a, b) => b.amount - a.amount);
  const top = sorted.slice(0, 5);
  const restAmount = sorted.slice(5).reduce((sum, c) => sum + c.amount, 0);
  const total = sorted.reduce((sum, c) => sum + c.amount, 0);
  const items = top.map((c, i) => ({ key: c.category, label: c.category, value: c.amount, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  if (restAmount > 0) items.push({ key: "rest", get label() { return t("أخرى"); }, value: restAmount, color: "var(--ink-3)" });

  return (
    <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
      {head}
      <HalfDonut items={items} centerLabel={t("الإجمالي")} centerValue={Math.round(total).toLocaleString("en-US")} />
      <div className="tat-rank-list">
        {items.map((it) => (
          <div key={it.key} className="tat-rank-row">
            <span className="tat-dot" style={{ background: it.color }} />
            <span className="name">{it.label}</span>
            <span className="tat-num amt">{formatMoney(it.value, "EGP")}</span>
            <span className="tat-mono pct">{total ? ((it.value / total) * 100).toFixed(1) : "0.0"}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
