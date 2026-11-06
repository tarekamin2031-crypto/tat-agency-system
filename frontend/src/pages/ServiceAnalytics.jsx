import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { TEAL, RED, GREEN, ORANGE, formatMoney } from "../theme";
import { HalfDonut, Legend } from "../components/Charts";
import { EmptyBox, LoadingBox, StatCard, Badge } from "../components/Bits";
import Icon from "../components/Icons";
import { t } from "../i18n";

const SORTS = [
  { id: "revenue", get label() { return t("الإيرادات"); } },
  { id: "netProfit", get label() { return t("صافي الربح"); } },
  { id: "clientCount", get label() { return t("العملاء"); } },
  { id: "profitMargin", get label() { return t("هامش الربح"); } },
];

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const isActive = (r) => r.revenue > 0 || r.expenses > 0 || (r.adCommission || 0) > 0 || r.netProfit !== 0;
const marginColor = (m) => (m >= 30 ? GREEN : m >= 10 ? ORANGE : RED);

export default function ServiceAnalytics() {
  const filters = useFilters();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("revenue");
  const [showIdle, setShowIdle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.financeByService(filters.toQueryString()));
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const sorted = useMemo(() => [...rows].sort((a, b) => b[sortBy] - a[sortBy]), [rows, sortBy]);
  const active = useMemo(() => sorted.filter(isActive), [sorted]);
  const idleCount = sorted.length - active.length;
  const tableRows = showIdle ? sorted : active;

  const totals = useMemo(() => ({
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    cashCollected: rows.reduce((s, r) => s + r.cashCollected, 0),
    adCommission: rows.reduce((s, r) => s + (r.adCommission || 0), 0),
    expenses: rows.reduce((s, r) => s + r.expenses, 0),
    netProfit: rows.reduce((s, r) => s + r.netProfit, 0),
  }), [rows]);

  const best = useMemo(() => [...rows].sort((a, b) => b.revenue - a.revenue)[0], [rows]);

  const donutItems = useMemo(() => {
    const withRevenue = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const items = withRevenue.slice(0, 4).map((r, i) => ({ key: String(r.serviceId ?? "none"), label: r.serviceName, value: r.revenue, color: PALETTE[i] }));
    const rest = withRevenue.slice(4).reduce((sum, r) => sum + r.revenue, 0);
    if (rest > 0) items.push({ key: "rest", get label() { return t("أخرى"); }, value: rest, color: PALETTE[4] });
    return items;
  }, [rows]);

  // the metric behind the ranking bars follows the chosen sort
  const metric = {
    revenue: { get: (r) => r.revenue, fmt: (v) => formatMoney(v, "EGP") },
    netProfit: { get: (r) => r.netProfit, fmt: (v) => formatMoney(v, "EGP") },
    clientCount: { get: (r) => r.clientCount, fmt: (v) => t("{v} عميل", { v: v }) },
    profitMargin: { get: (r) => r.profitMargin, fmt: (v) => `${v.toFixed(1)}%` },
  }[sortBy];
  const maxMetric = Math.max(1, ...active.map((r) => Math.abs(metric.get(r))));

  return (
    <div style={{ padding: 28 }}>
      <div className="tat-page-head">
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("تحليل الخدمات")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("أداء كل خدمة على حدة — عدد العملاء، الإيرادات، والربحية")}</div>
        </div>
        <div className="tat-page-actions">
          <span className="tat-label">{t("ترتيب حسب")}</span>
          <div className="tat-seg compact" role="radiogroup" aria-label={t("الترتيب")} style={{ margin: 0 }}>
            {SORTS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={sortBy === s.id} className={sortBy === s.id ? "on" : ""} onClick={() => setSortBy(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? <LoadingBox rows={4} /> : sorted.length === 0 ? <EmptyBox>{t("لا توجد خدمات مسجلة")}</EmptyBox> : (
        <>
          <div className="tat-bento tat-rise">
            <div className="span-3"><StatCard icon="banknote" label={t("إجمالي الإيرادات")} value={formatMoney(totals.revenue, "EGP")} color={TEAL} /></div>
            <div className="span-3"><StatCard icon="megaphone" label={t("عمولة الإعلانات")} value={formatMoney(totals.adCommission, "EGP")} color={ORANGE} /></div>
            <div className="span-3"><StatCard icon="trend" label={t("صافي الربح")} value={formatMoney(totals.netProfit, "EGP")} color={totals.netProfit >= 0 ? GREEN : RED} /></div>
            <div className="span-3"><StatCard icon="chart" label={t("أعلى خدمة إيرادًا")} value={best && best.revenue > 0 ? best.serviceName : "—"} sub={best && best.revenue > 0 ? formatMoney(best.revenue, "EGP") : null} color={GREEN} /></div>

            <div className="span-7">
              <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                <div className="tat-card-head">
                  <div className="tat-card-title"><span className="tat-ico" style={{ "--c": TEAL }}><Icon name="chart" size={17} /></span>{t("ترتيب الخدمات")}</div>
                  <span className="tat-label">{active.length}{" "}{t("خدمة نشطة")}{idleCount > 0 ? t(" · {idleCount} بدون نشاط", { idleCount: idleCount }) : ""}</span>
                </div>
                {active.length === 0 ? <EmptyBox>{t("لا يوجد نشاط في الفترة المختارة")}</EmptyBox> : (
                  <div className="tat-rank-svc">
                    {active.map((r, i) => {
                      const v = metric.get(r);
                      return (
                        <div key={r.serviceId ?? "none"} className="tat-svc-row">
                          <span className="rank tat-mono">{i + 1}</span>
                          <div className="main">
                            <div className="top">
                              <span className="name">{r.serviceName}</span>
                              <span className="tat-num val" style={{ color: v < 0 ? "var(--red)" : undefined }}>{metric.fmt(v)}</span>
                            </div>
                            <div className="track"><div className="fill" style={{ width: `${(Math.abs(v) / maxMetric) * 100}%`, background: v < 0 ? "var(--red)" : PALETTE[i % PALETTE.length] }} /></div>
                            <div className="sub">
                              <span>{r.clientCount}{" "}{t("عميل")}</span>
                              <Badge color={marginColor(r.profitMargin)}>{t("هامش")}{" "}{r.profitMargin.toFixed(1)}%</Badge>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="span-5">
              <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                <div className="tat-card-head"><div className="tat-card-title"><span className="tat-ico" style={{ "--c": GREEN }}><Icon name="pie" size={17} /></span>{t("توزيع الإيرادات")}</div></div>
                <HalfDonut items={donutItems} centerLabel={t("إجمالي الإيرادات")} centerValue={Math.round(totals.revenue).toLocaleString("en-US")} />
                <Legend items={donutItems.map((d) => ({ color: d.color, label: d.label }))} />
              </div>
            </div>
          </div>

          <div className="tat-section-title" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{t("تفاصيل الخدمات")}</span>
            {idleCount > 0 && (
              <button type="button" className="tat-tab" style={{ height: 34, fontSize: 12.5 }} onClick={() => setShowIdle((v) => !v)}>
                {showIdle ? "إخفاء الخدمات بدون نشاط" : t("إظهار {idleCount} خدمة بدون نشاط", { idleCount: idleCount })}
              </button>
            )}
          </div>
          <div className="tat-card" style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead>
                <tr>
                  <Th>{t("الخدمة")}</Th><Th>{t("العملاء")}</Th><Th>{t("الإيرادات")}</Th><Th>{t("المحصّل")}</Th><Th>{t("عمولة إعلانات")}</Th><Th>{t("المستحق")}</Th><Th>{t("المصاريف")}</Th><Th>{t("صافي الربح")}</Th><Th>{t("الهامش")}</Th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.serviceId ?? "none"} style={{ borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
                    <Td style={{ fontWeight: 600 }}>{r.serviceName}</Td>
                    <Td className="tat-num">{r.clientCount}</Td>
                    <Td className="tat-num">{formatMoney(r.revenue, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: "var(--green)" }}>{formatMoney(r.cashCollected, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: "var(--orange)" }}>{formatMoney(r.adCommission || 0, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: r.outstanding > 0 ? "var(--orange)" : "var(--ink-3)" }}>{formatMoney(r.outstanding, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: "var(--red)" }}>{formatMoney(r.expenses, "EGP")}</Td>
                    <Td className="tat-num" style={{ fontWeight: 700, color: r.netProfit >= 0 ? "var(--green)" : "var(--red)" }}>{formatMoney(r.netProfit, "EGP")}</Td>
                    <Td><Badge color={marginColor(r.profitMargin)}>{r.profitMargin.toFixed(1)}%</Badge></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", fontSize: 13, fontWeight: 700 }}>
                  <Td>{t("الإجمالي")}</Td>
                  <Td>—</Td>
                  <Td className="tat-num">{formatMoney(totals.revenue, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: "var(--green)" }}>{formatMoney(totals.cashCollected, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: "var(--orange)" }}>{formatMoney(totals.adCommission, "EGP")}</Td>
                  <Td>—</Td>
                  <Td className="tat-num" style={{ color: "var(--red)" }}>{formatMoney(totals.expenses, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: totals.netProfit >= 0 ? "var(--green)" : "var(--red)" }}>{formatMoney(totals.netProfit, "EGP")}</Td>
                  <Td>—</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children }) { return <th style={{ textAlign: "right", padding: "12px 14px", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children, style, className }) { return <td className={className} style={{ padding: "12px 14px", whiteSpace: "nowrap", ...style }}>{children}</td>; }
