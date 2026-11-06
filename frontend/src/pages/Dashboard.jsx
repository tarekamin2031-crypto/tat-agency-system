import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { useAccount } from "../context/AccountContext";
import { GOLD, TEAL, RED, GREEN, ORANGE, formatMoney, toISODate, INK } from "../theme";
import { EmptyBox, StatCard, LoadingBox, Delta } from "../components/Bits";
import { GroupedBarChart, Legend, Sparkline, StackedFlowChart, HighlightBarChart, HalfDonut } from "../components/Charts";
import WidgetPicker, { ALL_WIDGET_IDS, resolveEnabledWidgets } from "../components/WidgetPicker";
import Icon from "../components/Icons";
import { previousRange, pctChange, describeRange, rangeText } from "../utils/dateRange";
import { downloadCsv, printReport } from "../utils/exportReport";
import { t, MONTHS, locale } from "../i18n";

const MONTHS_AR = MONTHS;
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}

function addMonths(iso, months) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return toISODate(d);
}

function nextRenewalDate(client, todayISO) {
  const cycle = client.renewal_cycle || "once";
  const cycleMonths = cycle === "monthly" ? 1 : cycle === "quarterly" ? 3 : cycle === "yearly" ? 12 : null;
  const anchor = client.contract_end || client.contract_start;
  if (!anchor) return null;
  if (!cycleMonths) return anchor.slice(0, 10);
  let next = anchor.slice(0, 10);
  let guard = 0;
  while (next < todayISO && guard < 600) { next = addMonths(next, cycleMonths); guard++; }
  return next;
}

export default function Dashboard() {
  const filters = useFilters();
  const account = useAccount();
  const [allClients, setAllClients] = useState([]);
  const [finance, setFinance] = useState(null);
  const [prevFinance, setPrevFinance] = useState(null);
  const [paymentRows, setPaymentRows] = useState([]);
  const [monthlyTrend, setMonthlyTrend] = useState([]);
  const [byService, setByService] = useState([]);
  const [clientGrowth, setClientGrowth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [incomeTab, setIncomeTab] = useState("mix");
  const exportRef = useRef(null);

  const today = toISODate(new Date());
  const prevRange = useMemo(
    () => previousRange(filters.dateRange, filters.customFrom, filters.customTo),
    [filters.dateRange, filters.customFrom, filters.customTo]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filters.toQueryString();
      // Same filters, but for the period right before — powers the ▲/▼ change pills.
      let prevQuery = null;
      if (prevRange) {
        const p = new URLSearchParams(q);
        p.set("date_range", "custom");
        p.set("from", prevRange.from);
        p.set("to", prevRange.to);
        prevQuery = p.toString();
      }
      const [clients, fin, prev, payments, trend, services, growth] = await Promise.all([
        api.listClients(),           // unfiltered — status breakdown needs every client regardless of the global status filter
        api.financeSummary(q),
        prevQuery ? api.financeSummary(prevQuery) : Promise.resolve(null),
        api.paymentCenter(q),
        api.monthlyTrend(q),
        api.financeByService(q),
        api.clientGrowth(),
      ]);
      setAllClients(clients);
      setFinance(fin);
      setPrevFinance(prev);
      setPaymentRows(payments);
      setMonthlyTrend(trend);
      setByService(services);
      setClientGrowth(growth);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [filters, prevRange]);

  useEffect(() => { load(); }, [filters.key]);

  // close the export menu on outside click / Esc
  useEffect(() => {
    if (!exportOpen) return undefined;
    const onDown = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setExportOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [exportOpen]);

  const clientStats = useMemo(() => {
    const counts = { Active: 0, Suspended: 0, Stopped: 0, Expired: 0 };
    allClients.forEach((c) => { if (counts[c.status] !== undefined) counts[c.status]++; });
    return { total: allClients.length, ...counts };
  }, [allClients]);

  const upcomingRenewals = useMemo(() => {
    return allClients.filter((c) => {
      if (c.status !== "Active") return false;
      const target = nextRenewalDate(c, today);
      if (!target) return false;
      const days = Math.round((new Date(target) - new Date(today)) / 86400000);
      return days >= 0 && days <= 30;
    });
  }, [allClients, today]);

  const overduePayments = useMemo(() => {
    const overdue = paymentRows.filter((r) => r.payment_status === "Overdue");
    return { count: overdue.length, total: overdue.reduce((s, r) => s + Number(r.remaining_amount), 0) };
  }, [paymentRows]);

  const revenueGrowth = useMemo(() => {
    if (monthlyTrend.length < 2) return null;
    const last = monthlyTrend[monthlyTrend.length - 1];
    const prev = monthlyTrend[monthlyTrend.length - 2];
    if (!prev || prev.revenue === 0) return null;
    return ((last.revenue - prev.revenue) / prev.revenue) * 100;
  }, [monthlyTrend]);

  // ---- widgets (per-account preference; everything visible by default) ----
  const enabled = resolveEnabledWidgets(account.prefs.dashboardWidgets);
  const show = (id) => enabled.includes(id);
  const saveWidgets = (ids) => account.updatePrefs({ dashboardWidgets: ids }).catch((err) => notifyError(err));
  const toggleWidget = (id) => saveWidgets(enabled.includes(id) ? enabled.filter((w) => w !== id) : [...ALL_WIDGET_IDS.filter((w) => enabled.includes(w) || w === id)]);

  // ---- comparison helpers ----
  const cmp = (key, invert = false) => (prevFinance ? { pct: pctChange(finance?.[key], prevFinance[key]), invert } : null);
  const prevLine = (key) => (prevFinance ? t("الفترة السابقة: {v1}", { v1: formatMoney(prevFinance[key], "EGP") }) : null);
  const periodText = filters.dateRange === "all" ? t("كل الفترات") : rangeText(filters.dateRange, filters.customFrom, filters.customTo);
  const prevText = prevRange ? describeRange(prevRange.from, prevRange.to) : null;

  // ---- export ----
  const exportCsv = () => {
    const f = finance || {};
    const p = prevFinance || null;
    const pct = (k) => (p ? (pctChange(f[k], p[k]) === null ? "" : pctChange(f[k], p[k]).toFixed(1) + "%") : "");
    const kpi = (label, k) => [label, f[k] ?? 0, p ? p[k] ?? 0 : "", pct(k)];
    const rows = [
      [t("تقرير لوحة القيادة")],
      [t("الفترة"), periodText],
      [t("الفترة السابقة (للمقارنة)"), prevText || "—"],
      [t("تاريخ التصدير"), new Date().toLocaleString(locale())],
      [],
      [t("المؤشر"), t("الفترة الحالية (EGP)"), t("الفترة السابقة (EGP)"), t("التغيّر")],
      kpi(t("الإيرادات"), "revenue"),
      kpi(t("المحصّل"), "cashCollected"),
      kpi(t("عمولة الإعلانات"), "adCommission"),
      kpi(t("إجمالي الدخل"), "totalIncome"),
      kpi(t("المصاريف"), "totalExpenses"),
      kpi(t("صافي الربح"), "netProfit"),
      kpi(t("المستحق"), "outstandingBalance"),
      [t("هامش الربح %"), (f.profitMargin ?? 0).toFixed(1), p ? (p.profitMargin ?? 0).toFixed(1) : "", ""],
      [],
      [t("العملاء"), t("العدد")],
      [t("الإجمالي"), clientStats.total], [t("نشطين"), clientStats.Active], [t("متوقفين مؤقتًا"), clientStats.Suspended],
      [t("متوقفين"), clientStats.Stopped], [t("منتهية عقودهم"), clientStats.Expired], [t("تجديدات خلال 30 يوم"), upcomingRenewals.length],
      [],
      [t("الشهر"), t("الإيرادات"), t("المحصّل"), t("عمولة الإعلانات"), t("المصاريف"), t("صافي الربح")],
      ...monthlyTrend.map((m) => [m.month, m.revenue, m.cashCollected, m.adCommission ?? 0, m.expenses, m.netProfit]),
      [],
      [t("الخدمة"), t("الإيرادات"), t("المحصّل"), t("عمولة الإعلانات"), t("المصاريف"), t("صافي الربح")],
      ...byService.map((s) => [s.serviceName, s.revenue, s.cashCollected, s.adCommission ?? 0, s.expenses, s.netProfit]),
    ];
    downloadCsv(`dashboard-report-${today}.csv`, rows);
    notifySuccess(t("تم تنزيل التقرير"));
  };

  // ---- chart data ----
  const mixSeries = [
    { key: "collected", get label() { return t("المحصّل"); }, color: "var(--chart-1)" },
    { key: "ad", get label() { return t("عمولة الإعلانات"); }, color: "var(--chart-3)" },
    { key: "out", get label() { return t("المستحق"); }, color: "var(--chart-5)" },
  ];
  const mixData = monthlyTrend.slice(-6).map((m) => ({
    key: m.month,
    label: MONTHS_AR[Number(m.month.split("-")[1]) - 1],
    parts: { collected: m.cashCollected, ad: m.adCommission || 0, out: Math.max(0, m.revenue - m.cashCollected) },
  }));
  const incomeDelta = prevFinance ? pctChange(finance?.totalIncome, prevFinance.totalIncome) : null;
  const incomeDiff = prevFinance ? (finance?.totalIncome || 0) - (prevFinance.totalIncome || 0) : null;

  const distribution = useMemo(() => {
    const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
    const sorted = byService.filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const top = sorted.slice(0, 4).map((s, i) => ({ key: String(s.serviceId ?? "none"), label: s.serviceName, value: s.revenue, color: palette[i] }));
    const rest = sorted.slice(4).reduce((sum, s) => sum + s.revenue, 0);
    if (rest > 0) top.push({ key: "rest", get label() { return t("أخرى"); }, value: rest, color: palette[4] });
    return top;
  }, [byService]);
  // services with no activity in the period would just be rows of zeros
  const activeServices = byService.filter((s) => s.revenue > 0 || s.expenses > 0 || (s.adCommission || 0) > 0);
  const distributionTotal = distribution.reduce((sum, d) => sum + d.value, 0);

  // ---- layout spans: a hidden neighbour lets the other widget fill the row ----
  const trendSpan = show("clients") ? "span-8" : "span-12";
  const clientsSpan = show("trend") ? "span-4" : "span-12";

  return (
    <div style={{ padding: 28 }}>
      <div className="tat-page-head">
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("لوحة القيادة التنفيذية")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {t("نظرة شاملة على أداء الأجينسي")}{prevText ? <>{" "}{t("· مقارنة بالفترة السابقة (")}<span className="tat-num">{prevText}</span>)</> : null}
          </div>
        </div>
        <div className="tat-page-actions no-print">
          <button type="button" className="tat-btn-ghost" onClick={() => setPickerOpen(true)}>
            <Icon name="widgets" size={16} /><span>{t("إضافة ويدجت")}</span>
          </button>
          <div className="tat-pop-wrap" ref={exportRef}>
            <button type="button" className="tat-btn-primary" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>
              <Icon name="download" size={16} /><span>{t("تصدير التقرير")}</span><Icon name="chevron" size={14} />
            </button>
            {exportOpen && (
              <div className="tat-pop tat-card" style={{ minWidth: 230 }}>
                <button type="button" className="tat-opt" onClick={() => { setExportOpen(false); exportCsv(); }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name="table" size={16} />{t("ملف Excel (CSV)")}</span>
                </button>
                <button type="button" className="tat-opt" onClick={() => { setExportOpen(false); printReport(); }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name="printer" size={16} />{t("طباعة / حفظ PDF")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? <LoadingBox rows={4} /> : enabled.length === 0 ? (
        <EmptyBox>
          <div style={{ marginBottom: 12 }}>{t("مفيش ويدجتس معروضة دلوقتي.")}</div>
          <button type="button" className="tat-btn-primary" onClick={() => setPickerOpen(true)}><Icon name="plus" size={16} /><span>{t("إضافة ويدجت")}</span></button>
        </EmptyBox>
      ) : (
        <>
          <div className="tat-bento tat-rise">
            {show("kpis") && (
              <>
                <div className="span-3"><StatCard icon="banknote" label={t("الإيرادات")} value={formatMoney(finance?.revenue, "EGP")} color={TEAL} delta={cmp("revenue")} sub={prevLine("revenue")} /></div>
                <div className="span-3"><StatCard icon="checkCircle" label={t("المحصّل")} value={formatMoney(finance?.cashCollected, "EGP")} color={GREEN} delta={cmp("cashCollected")} sub={prevLine("cashCollected")} /></div>
                <div className="span-3"><StatCard icon="megaphone" label={t("عمولة الإعلانات")} value={formatMoney(finance?.adCommission, "EGP")} color={ORANGE} delta={cmp("adCommission")} sub={prevLine("adCommission")} /></div>
                <div className="span-3"><StatCard icon="receipt" label={t("المصاريف")} value={formatMoney(finance?.totalExpenses, "EGP")} color={RED} delta={cmp("totalExpenses", true)} sub={prevLine("totalExpenses")} /></div>
              </>
            )}

            {show("profit") && (
              <>
                <div className="span-8">
                  <HeroStat
                    label={t("صافي الربح")}
                    value={formatMoney(finance?.netProfit, "EGP")}
                    color={(finance?.netProfit ?? 0) >= 0 ? GREEN : RED}
                    delta={cmp("netProfit")}
                    sub={prevLine("netProfit")}
                    series={monthlyTrend.map((m) => m.netProfit)}
                    foot={[
                      { k: t("هامش الربح"), v: `${(finance?.profitMargin ?? 0).toFixed(1)}%` },
                      { k: t("إجمالي الدخل"), v: formatMoney(finance?.totalIncome, "EGP") },
                    ]}
                  />
                </div>
                <div className="span-4">
                  <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14 }}>
                    <div className="tat-stat-head" style={{ marginBottom: 0 }}>
                      <div className="tat-label">{t("نمو الإيرادات (آخر شهر)")}</div>
                      <span className="tat-ico" style={{ "--c": revenueGrowth !== null && revenueGrowth < 0 ? RED : GREEN }}><Icon name="trend" size={17} /></span>
                    </div>
                    <div className="tat-num" dir="ltr" style={{ textAlign: "right", fontSize: 28, fontWeight: 700, color: revenueGrowth === null ? "var(--ink-3)" : revenueGrowth >= 0 ? GREEN : RED }}>
                      {revenueGrowth === null ? "—" : `${revenueGrowth >= 0 ? "+" : ""}${revenueGrowth.toFixed(1)}%`}
                    </div>
                    <div style={{ height: 1, background: "var(--border)" }} />
                    <div className="tat-stat-head" style={{ marginBottom: 0 }}>
                      <div className="tat-label">{t("مدفوعات متأخرة")}</div>
                      <span className="tat-ico" style={{ "--c": overduePayments.count > 0 ? RED : GREEN }}><Icon name="clock" size={17} /></span>
                    </div>
                    <div>
                      <div className="tat-num" style={{ fontSize: 22, fontWeight: 700, color: overduePayments.count > 0 ? RED : GREEN }}>
                        {overduePayments.count > 0 ? formatMoney(overduePayments.total, "EGP") : t("لا يوجد")}
                      </div>
                      {overduePayments.count > 0 && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{overduePayments.count}{" "}{t("دفعة متأخرة")}</div>}
                    </div>
                  </div>
                </div>
              </>
            )}

            {show("trend") && (
              <div className={trendSpan}>
                <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                  <div className="tat-card-head">
                    <div className="tat-card-title"><span className="tat-ico" style={{ "--c": GREEN }}><Icon name="chart" size={17} /></span>{t("نظرة على الدخل")}</div>
                    <div className="tat-seg compact">
                      <button type="button" className={incomeTab === "mix" ? "on" : ""} onClick={() => setIncomeTab("mix")}>{t("تركيب الدخل")}</button>
                      <button type="button" className={incomeTab === "cmp" ? "on" : ""} onClick={() => setIncomeTab("cmp")}>{t("إيرادات ومصاريف")}</button>
                    </div>
                  </div>
                  {incomeTab === "mix" && (
                    <div className="tat-big-row">
                      <div className="tat-num tat-big">{formatMoney(finance?.totalIncome, "EGP")}</div>
                      {prevFinance && <Delta pct={incomeDelta} />}
                      {incomeDiff !== null && <span className="tat-big-sub">{incomeDiff >= 0 ? "+" : "−"} {formatMoney(Math.abs(incomeDiff), "EGP")} {incomeDiff >= 0 ? t("زيادة") : t("نقص")}{" "}{t("عن الفترة السابقة")}</span>}
                    </div>
                  )}
                  {monthlyTrend.length === 0 ? <EmptyBox>{t("لا توجد بيانات كافية")}</EmptyBox> : incomeTab === "mix" ? (
                    <>
                      <StackedFlowChart data={mixData} series={mixSeries} height={290} />
                      <Legend items={mixSeries.map((x) => ({ color: x.color, label: x.label }))} />
                    </>
                  ) : (
                    <>
                      <Legend items={[{ color: INK, get label() { return t("إيرادات"); } }, { color: GREEN, get label() { return t("محصّل"); } }, { color: RED, get label() { return t("مصاريف"); } }]} />
                      <GroupedBarChart
                        data={monthlyTrend.map((m) => ({ ...m, key: m.month, label: monthLabel(m.month) }))}
                        series={[{ key: "revenue", get label() { return t("إيرادات"); }, color: INK }, { key: "cashCollected", get label() { return t("محصّل"); }, color: GREEN }, { key: "expenses", get label() { return t("مصاريف"); }, color: RED }]}
                        getValue={(row, s) => row[s.key]}
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            {show("clients") && (
              <div className={clientsSpan}>
                <div className="tat-card" style={{ padding: 20, height: "100%", boxSizing: "border-box" }}>
                  <div className="tat-stat-head">
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{t("العملاء")}</div>
                    <span className="tat-ico" style={{ "--c": TEAL }}><Icon name="users" size={17} /></span>
                  </div>
                  <div className="tat-num" style={{ fontSize: 34, fontWeight: 700, marginBottom: 10 }}>{clientStats.total}</div>
                  {[
                    [t("نشطين"), clientStats.Active, GREEN],
                    [t("متوقفين مؤقتًا"), clientStats.Suspended, GOLD],
                    [t("متوقفين"), clientStats.Stopped, "var(--ink-3)"],
                    [t("منتهية عقودهم"), clientStats.Expired, RED],
                    [t("تجديدات خلال 30 يوم"), upcomingRenewals.length, TEAL],
                  ].map(([label, n, c]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: "var(--ink-2)" }}>{label}</span>
                      <span className="tat-mono" style={{ fontWeight: 700 }}>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {show("cash") && (
              <>
                <div className="span-4"><StatCard icon="clock" label={t("المستحق (غير محصّل)")} value={formatMoney(finance?.outstandingBalance, "EGP")} color={ORANGE} delta={cmp("outstandingBalance", true)} sub={prevLine("outstandingBalance")} /></div>
                <div className="span-4"><StatCard icon="wallet" label={t("الربح بعد المصاريف الشخصية")} value={formatMoney(finance?.profitAfterPersonal, "EGP")} color={(finance?.profitAfterPersonal ?? 0) >= 0 ? GREEN : RED} delta={cmp("profitAfterPersonal")} sub={prevLine("profitAfterPersonal")} /></div>
                <div className="span-4"><StatCard icon="banknote" label={t("رصيد النقدية المتاح")} value={formatMoney(finance?.cashAvailable, "EGP")} color={TEAL} delta={cmp("cashAvailable")} sub={prevLine("cashAvailable")} /></div>
              </>
            )}
          </div>

          {(show("distribution") || show("growth")) && (
            <div className="tat-bento tat-rise">
              {show("distribution") && (
                <div className={show("growth") ? "span-4" : "span-12"}>
                  <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                    <div className="tat-card-head">
                      <div className="tat-card-title"><span className="tat-ico" style={{ "--c": TEAL }}><Icon name="pie" size={17} /></span>{t("توزيع الإيرادات")}</div>
                    </div>
                    {distribution.length === 0 ? <EmptyBox>{t("لا توجد بيانات")}</EmptyBox> : (
                      <>
                        <div className="tat-dist-top">
                          {distribution.slice(0, 3).map((d) => (
                            <div key={d.key} className="tat-dist-item" style={{ "--c": d.color }}>
                              <div className="l">{d.label}</div>
                              <div className="tat-num v">{formatMoney(d.value, "EGP")}</div>
                            </div>
                          ))}
                        </div>
                        <HalfDonut items={distribution} centerLabel={t("إجمالي الإيرادات")} centerValue={Math.round(distributionTotal).toLocaleString("en-US")} />
                        <Legend items={distribution.map((d) => ({ color: d.color, label: d.label }))} />
                      </>
                    )}
                  </div>
                </div>
              )}

              {show("growth") && (
                <div className={show("distribution") ? "span-8" : "span-12"}>
                  <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                    <div className="tat-card-head">
                      <div className="tat-card-title"><span className="tat-ico" style={{ "--c": GREEN }}><Icon name="users" size={17} /></span>{t("نمو العملاء")}</div>
                      <span className="tat-label">{t("عملاء جدد · آخر 12 شهر")}</span>
                    </div>
                    {clientGrowth.length === 0 ? <EmptyBox>{t("لا توجد بيانات")}</EmptyBox> : (
                      <>
                        <div className="tat-big-row">
                          <div className="tat-num tat-big">{clientGrowth.reduce((sum, m) => sum + m.newClients, 0)}</div>
                          <span className="tat-big-sub">{t("عميل جديد خلال الفترة المعروضة")}</span>
                        </div>
                        <HighlightBarChart
                          data={clientGrowth.map((m) => ({ key: m.month, label: MONTHS_AR[Number(m.month.split("-")[1]) - 1], value: m.newClients }))}
                          format={(v) => t("{v} عميل", { v: v })}
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {show("byService") && (
            <div style={{ marginBottom: 24 }}>
              <SectionTitle>{t("الإيرادات والربح حسب الخدمة")}</SectionTitle>
              <div className="tat-card" style={{ overflow: "hidden" }}>
                {activeServices.length === 0 ? <EmptyBox>{t("لا توجد بيانات")}</EmptyBox> : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ fontSize: 11.5, color: "var(--ink-3)", borderBottom: "1px solid var(--border-soft)" }}>
                        <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("الخدمة")}</th>
                        <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("الإيرادات")}</th>
                        <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("عمولة الإعلانات")}</th>
                        <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("صافي الربح")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeServices.map((s, i) => (
                        <tr key={i} style={{ fontSize: 12.5, borderTop: "1px solid var(--border-soft)" }}>
                          <td style={{ padding: "8px 12px", fontWeight: 600 }}>{s.serviceName}</td>
                          <td style={{ padding: "8px 12px" }}>{formatMoney(s.revenue, "EGP")}</td>
                          <td style={{ padding: "8px 12px" }}>{formatMoney(s.adCommission || 0, "EGP")}</td>
                          <td style={{ padding: "8px 12px", color: s.netProfit >= 0 ? GREEN : RED }}>{formatMoney(s.netProfit, "EGP")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {pickerOpen && (
        <WidgetPicker
          enabled={enabled}
          onToggle={toggleWidget}
          onReset={() => saveWidgets(ALL_WIDGET_IDS)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 10 }}>{children}</div>;
}

function HeroStat({ label, value, color, delta, sub, series, foot }) {
  return (
    <div className="tat-card" style={{ position: "relative", overflow: "hidden", padding: 26, height: "100%", boxSizing: "border-box", minHeight: 190 }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: `radial-gradient(420px 180px at 0% 0%, color-mix(in srgb, ${color} 18%, transparent), transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative" }}>
        <div className="tat-stat-head" style={{ marginBottom: 0 }}>
          <div className="tat-label">{label}</div>
          <span className="tat-ico" style={{ "--c": color }}><Icon name="trend" size={17} /></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 4px" }}>
          <div className="tat-num" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.1, color }}>{value}</div>
          {delta && <Delta pct={delta.pct} invert={delta.invert} />}
        </div>
        {sub && <div className="tat-stat-sub" style={{ margin: "0 0 10px" }}>{sub}</div>}
        <Sparkline values={series} color={color} />
        <div style={{ display: "flex", gap: 28, marginTop: 14, flexWrap: "wrap" }}>
          {foot.map((f) => (
            <div key={f.k}>
              <div className="tat-label">{f.k}</div>
              <div className="tat-num" style={{ fontSize: 16, fontWeight: 600 }}>{f.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
