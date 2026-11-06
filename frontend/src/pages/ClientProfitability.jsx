import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { TEAL, RED, GREEN, ORANGE, formatMoney } from "../theme";
import { HalfDonut, Legend } from "../components/Charts";
import { EmptyBox, LoadingBox, StatCard, Badge } from "../components/Bits";
import Icon from "../components/Icons";
import { t } from "../i18n";

const VIEWS = [
  { id: "most_profitable", get label() { return t("الأكثر ربحية"); }, get: (r) => r.netProfit, sort: (a, b) => b.netProfit - a.netProfit, fmt: (v) => formatMoney(v, "EGP") },
  { id: "least_profitable", get label() { return t("الأقل ربحية"); }, get: (r) => r.netProfit, sort: (a, b) => a.netProfit - b.netProfit, fmt: (v) => formatMoney(v, "EGP") },
  { id: "highest_revenue", get label() { return t("الأعلى إيرادًا"); }, get: (r) => r.revenue, sort: (a, b) => b.revenue - a.revenue, fmt: (v) => formatMoney(v, "EGP") },
  { id: "highest_outstanding", get label() { return t("الأعلى مستحقات"); }, get: (r) => r.outstandingBalance, sort: (a, b) => b.outstandingBalance - a.outstandingBalance, fmt: (v) => formatMoney(v, "EGP") },
];

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const marginColor = (m) => (m >= 30 ? GREEN : m >= 10 ? ORANGE : RED);

export default function ClientProfitability() {
  const filters = useFilters();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("most_profitable");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.clientProfitability(filters.toQueryString()));
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const current = VIEWS.find((v) => v.id === view);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || r.clientName.toLowerCase().includes(q));
  }, [rows, search]);

  const ranked = useMemo(() => [...filtered].sort(current.sort), [filtered, current]);

  // totals follow the search so the cards always describe what is listed
  const totals = useMemo(() => ({
    revenue: filtered.reduce((s, r) => s + r.revenue, 0),
    cash: filtered.reduce((s, r) => s + r.cashCollected, 0),
    ad: filtered.reduce((s, r) => s + (r.adCommission || 0), 0),
    outstanding: filtered.reduce((s, r) => s + r.outstandingBalance, 0),
    expenses: filtered.reduce((s, r) => s + r.clientExpenses, 0),
    net: filtered.reduce((s, r) => s + r.netProfit, 0),
  }), [filtered]);
  const totalMargin = totals.cash + totals.ad > 0 ? (totals.net / (totals.cash + totals.ad)) * 100 : 0;

  const best = useMemo(() => [...filtered].sort((a, b) => b.netProfit - a.netProfit)[0], [filtered]);
  const losing = filtered.filter((r) => r.netProfit < 0).length;

  const top = ranked.slice(0, 10);
  const maxMetric = Math.max(1, ...top.map((r) => Math.abs(current.get(r))));

  // share of net profit among the most profitable clients (positive profit only)
  const donutItems = useMemo(() => {
    const pos = [...filtered].filter((r) => r.netProfit > 0).sort((a, b) => b.netProfit - a.netProfit);
    const items = pos.slice(0, 4).map((r, i) => ({ key: String(r.clientId), label: r.clientName, value: r.netProfit, color: PALETTE[i] }));
    const rest = pos.slice(4).reduce((s, r) => s + r.netProfit, 0);
    if (rest > 0) items.push({ key: "rest", get label() { return t("أخرى"); }, value: rest, color: PALETTE[4] });
    return items;
  }, [filtered]);
  const donutTotal = donutItems.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ padding: 28 }}>
      <div className="tat-page-head">
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("ربحية العملاء")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("صافي الربح لكل عميل = المحصّل فعليًا + عمولة الإعلانات − المصاريف المرتبطة به")}</div>
        </div>
        <div className="tat-page-actions">
          <div className="tat-sbox" style={{ width: 230 }}>
            <span className="tat-sbox-icon"><Icon name="search" size={17} /></span>
            <input className="tat-sbox-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ابحث بالعميل...")} />
            {search && <button className="tat-sbox-clear" onClick={() => setSearch("")} aria-label={t("مسح")}>×</button>}
          </div>
          <div className="tat-seg compact" role="radiogroup" aria-label={t("الترتيب")} style={{ margin: 0 }}>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>{v.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? <LoadingBox rows={4} /> : ranked.length === 0 ? <EmptyBox>{t("لا يوجد عملاء مطابقين")}</EmptyBox> : (
        <>
          <div className="tat-bento tat-rise">
            <div className="span-3"><StatCard icon="trend" label={t("صافي الربح")} value={formatMoney(totals.net, "EGP")} color={totals.net >= 0 ? GREEN : RED} sub={`${t("هامش الربح")} ${totalMargin.toFixed(1)}%`} /></div>
            <div className="span-3"><StatCard icon="banknote" label={t("المحصّل")} value={formatMoney(totals.cash, "EGP")} color={TEAL} sub={`${t("الإيرادات")}: ${formatMoney(totals.revenue, "EGP")}`} /></div>
            <div className="span-3"><StatCard icon="megaphone" label={t("عمولة إعلانات")} value={formatMoney(totals.ad, "EGP")} color={ORANGE} sub={`${t("مصاريف مرتبطة")}: ${formatMoney(totals.expenses, "EGP")}`} /></div>
            <div className="span-3"><StatCard icon="chart" label={t("الأكثر ربحية")} value={best && best.netProfit > 0 ? best.clientName : "—"} sub={best && best.netProfit > 0 ? formatMoney(best.netProfit, "EGP") : null} color={GREEN} /></div>

            <div className="span-7">
              <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                <div className="tat-card-head">
                  <div className="tat-card-title"><span className="tat-ico" style={{ "--c": GREEN }}><Icon name="chart" size={17} /></span>{t("صافي الربح — أول 10 عملاء حسب الترتيب الحالي")}</div>
                  {losing > 0 && <Badge color={RED}>{t("{n} عميل خاسر", { n: losing })}</Badge>}
                </div>
                <div className="tat-rank-svc">
                  {top.map((r, i) => {
                    const v = current.get(r);
                    return (
                      <div key={r.clientId} className="tat-svc-row">
                        <span className="rank tat-mono">{i + 1}</span>
                        <div className="main">
                          <div className="top">
                            <span className="name">{r.clientName}</span>
                            <span className="tat-num val" style={{ color: v < 0 ? "var(--red)" : undefined }}>{current.fmt(v)}</span>
                          </div>
                          <div className="track"><div className="fill" style={{ width: `${(Math.abs(v) / maxMetric) * 100}%`, background: v < 0 ? "var(--red)" : PALETTE[i % PALETTE.length] }} /></div>
                          <div className="sub">
                            <span>{t("الإيرادات")}: <span className="tat-num">{formatMoney(r.revenue, "EGP")}</span></span>
                            <Badge color={marginColor(r.profitMargin)}>{t("هامش")}{" "}{r.profitMargin.toFixed(1)}%</Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="span-5">
              <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                <div className="tat-card-head"><div className="tat-card-title"><span className="tat-ico" style={{ "--c": TEAL }}><Icon name="pie" size={17} /></span>{t("توزيع صافي الربح")}</div></div>
                {donutItems.length === 0 ? <EmptyBox>{t("لا توجد أرباح في الفترة المختارة")}</EmptyBox> : (
                  <>
                    <HalfDonut items={donutItems} centerLabel={t("صافي الربح")} centerValue={Math.round(donutTotal).toLocaleString("en-US")} />
                    <Legend items={donutItems.map((d) => ({ color: d.color, label: d.label }))} />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="tat-section-title"><span style={{ display: "flex", alignItems: "center", gap: 10 }}>{t("تفاصيل العملاء")}</span></div>
          <div className="tat-card" style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <Th>#</Th><Th>{t("العميل")}</Th><Th>{t("الإيرادات")}</Th><Th>{t("المحصّل")}</Th><Th>{t("عمولة إعلانات")}</Th><Th>{t("المستحق")}</Th><Th>{t("مصاريف مرتبطة")}</Th><Th>{t("صافي الربح")}</Th><Th>{t("هامش الربح")}</Th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.clientId} style={{ borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
                    <Td style={{ color: "var(--ink-3)" }}>{i + 1}</Td>
                    <Td style={{ fontWeight: 600 }}>{r.clientName}</Td>
                    <Td className="tat-num">{formatMoney(r.revenue, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: "var(--green)" }}>{formatMoney(r.cashCollected, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: "var(--orange)" }}>{formatMoney(r.adCommission || 0, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: r.outstandingBalance > 0 ? "var(--orange)" : "var(--ink-3)" }}>{formatMoney(r.outstandingBalance, "EGP")}</Td>
                    <Td className="tat-num" style={{ color: "var(--red)" }}>{formatMoney(r.clientExpenses, "EGP")}</Td>
                    <Td className="tat-num" style={{ fontWeight: 700, color: r.netProfit >= 0 ? "var(--green)" : "var(--red)" }}>{formatMoney(r.netProfit, "EGP")}</Td>
                    <Td><Badge color={marginColor(r.profitMargin)}>{r.profitMargin.toFixed(1)}%</Badge></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", fontSize: 13, fontWeight: 700 }}>
                  <Td>—</Td><Td>{t("الإجمالي")}</Td>
                  <Td className="tat-num">{formatMoney(totals.revenue, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: "var(--green)" }}>{formatMoney(totals.cash, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: "var(--orange)" }}>{formatMoney(totals.ad, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: "var(--orange)" }}>{formatMoney(totals.outstanding, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: "var(--red)" }}>{formatMoney(totals.expenses, "EGP")}</Td>
                  <Td className="tat-num" style={{ color: totals.net >= 0 ? "var(--green)" : "var(--red)" }}>{formatMoney(totals.net, "EGP")}</Td>
                  <Td><Badge color={marginColor(totalMargin)}>{totalMargin.toFixed(1)}%</Badge></Td>
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
