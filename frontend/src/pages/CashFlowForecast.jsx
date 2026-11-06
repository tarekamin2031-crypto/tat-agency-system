import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { RED, GREEN, ORANGE, formatMoney, tint } from "../theme";
import { StackedFlowChart, HalfDonut, Legend } from "../components/Charts";
import { StatCard, LoadingBox } from "../components/Bits";
import Icon from "../components/Icons";
import { t } from "../i18n";

const PERIODS = [
  { id: 1, get label() { return t("الشهر القادم"); }, short: "شهر" },
  { id: 3, get label() { return t("أول 3 شهور"); }, short: "3 شهور" },
  { id: 6, get label() { return t("أول 6 شهور"); }, short: "6 شهور" },
];

const SERIES = [
  { key: "confirmed", get label() { return t("مؤكد"); }, color: "var(--chart-1)" },
  { key: "expected", get label() { return t("متوقع"); }, color: "var(--chart-5)" },
  { key: "atRisk", get label() { return t("في خطر"); }, color: "var(--red)" },
];

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

export default function CashFlowForecast() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(3);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.cashFlowForecast());
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    if (!data) return {};
    const out = {};
    PERIODS.forEach(({ id }) => {
      const p = data.periods[id];
      out[id] = p.confirmed + p.expected + p.atRisk;
    });
    return out;
  }, [data]);

  const cur = data ? data.periods[period] : null;
  const total = cur ? totals[period] : 0;
  const inflow = cur ? cur.confirmed + cur.expected : 0; // money we expect to actually receive
  const curLabel = PERIODS.find((p) => p.id === period).label;

  return (
    <div style={{ padding: 28 }}>
      <div className="tat-page-head">
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("توقعات التدفق النقدي")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("مؤكد (عقود متجددة تلقائيًا) + متوقع (فواتير مجدولة) + في خطر (متأخرات وعملاء متوقفين)")}</div>
        </div>
        <div className="tat-seg compact" role="radiogroup" aria-label={t("الفترة")} style={{ margin: 0 }}>
          {PERIODS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={period === p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>

      {loading || !data ? <LoadingBox rows={4} /> : (
        <>
          {data.overdueTotal > 0 && (
            <div className="tat-row" style={{ marginBottom: 18, borderColor: tint(RED, 35) }}>
              <span className="tat-ico" style={{ "--c": RED }}><Icon name="bell" size={19} /></span>
              <div style={{ flex: 1, fontSize: 13.5 }}>{t("يوجد حاليًا")}{" "}<strong className="tat-num" style={{ color: RED }}>{formatMoney(data.overdueTotal, data.currency)}</strong>{" "}{t("متأخرات فعلية — مُدرجة كـ\"في خطر\" في كل الفترات لحد ما تتحصّل.")}</div>
            </div>
          )}

          <div className="tat-bento tat-rise">
            {/* hero: total + composition strip */}
            <div className="span-8">
              <div className="tat-card" style={{ position: "relative", overflow: "hidden", padding: 26, height: "100%", boxSizing: "border-box" }}>
                <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(420px 180px at 0% 0%, color-mix(in srgb, var(--chart-1) 16%, transparent), transparent 70%)" }} />
                <div style={{ position: "relative" }}>
                  <div className="tat-stat-head" style={{ marginBottom: 0 }}>
                    <div className="tat-label">{t("إجمالي التدفق المتوقع ·")}{" "}{curLabel}</div>
                    <span className="tat-ico" style={{ "--c": GREEN }}><Icon name="activity" size={17} /></span>
                  </div>
                  <div className="tat-num" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.1, margin: "10px 0 6px" }}>{formatMoney(total, data.currency)}</div>
                  <div className="tat-stat-sub" style={{ margin: "0 0 16px" }}>{t("منهم")}{" "}<b className="tat-num" style={{ color: "var(--ink)" }}>{formatMoney(inflow, data.currency)}</b> {t("تحصيل متوقع ({p}%) و", { p: pct(inflow, total) })} <b className="tat-num" style={{ color: "var(--red)" }}>{formatMoney(cur.atRisk, data.currency)}</b>{" "}{t("في خطر")}</div>

                  <div className="tat-strip" role="img" aria-label={t("تركيب التدفق")}>
                    {SERIES.map((s) => (cur[s.key] > 0 ? (
                      <div key={s.key} title={`${s.label}: ${formatMoney(cur[s.key], data.currency)}`} style={{ flexGrow: cur[s.key], background: s.color }} />
                    ) : null))}
                  </div>
                  <div className="tat-strip-legend">
                    {SERIES.map((s) => (
                      <div key={s.key}>
                        <span className="tat-dot" style={{ background: s.color }} />
                        <span style={{ color: "var(--ink-3)" }}>{s.label}</span>
                        <b className="tat-mono">{pct(cur[s.key], total)}%</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* donut */}
            <div className="span-4">
              <div className="tat-card" style={{ padding: 22, height: "100%", boxSizing: "border-box" }}>
                <div className="tat-card-head"><div className="tat-card-title"><span className="tat-ico" style={{ "--c": "var(--chart-3)" }}><Icon name="pie" size={17} /></span>{t("تركيب التدفق")}</div></div>
                <HalfDonut items={SERIES.map((s) => ({ key: s.key, label: s.label, value: cur[s.key], color: s.color }))} centerLabel={t("الإجمالي")} centerValue={Math.round(total).toLocaleString("en-US")} />
                <Legend items={SERIES.map((s) => ({ color: s.color, label: s.label }))} />
              </div>
            </div>

            {/* three KPI cards for the selected period */}
            <div className="span-4"><StatCard icon="checkCircle" label={t("مؤكد")} value={formatMoney(cur.confirmed, data.currency)} color={GREEN} sub={t("{p}% من الإجمالي", { p: pct(cur.confirmed, total) })} /></div>
            <div className="span-4"><StatCard icon="clock" label={t("متوقع")} value={formatMoney(cur.expected, data.currency)} color={ORANGE} sub={t("{p}% من الإجمالي", { p: pct(cur.expected, total) })} /></div>
            <div className="span-4"><StatCard icon="bell" label={t("في خطر")} value={formatMoney(cur.atRisk, data.currency)} color={RED} sub={t("{p}% من الإجمالي", { p: pct(cur.atRisk, total) })} /></div>

            {/* all periods side by side */}
            <div className="span-12">
              <div className="tat-card" style={{ padding: 22 }}>
                <div className="tat-card-head">
                  <div className="tat-card-title"><span className="tat-ico" style={{ "--c": GREEN }}><Icon name="chart" size={17} /></span>{t("مقارنة الفترات")}</div>
                </div>
                <StackedFlowChart
                  height={270}
                  data={PERIODS.map((p) => ({ key: String(p.id), label: p.label, parts: { confirmed: data.periods[p.id].confirmed, expected: data.periods[p.id].expected, atRisk: data.periods[p.id].atRisk } }))}
                  series={SERIES}
                />
                <Legend items={SERIES.map((s) => ({ color: s.color, label: s.label }))} />
              </div>
            </div>

            {/* compact table */}
            <div className="span-12">
              <div className="tat-card" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead>
                    <tr>
                      {[t("الفترة"), t("مؤكد"), t("متوقع"), t("في خطر"), t("الإجمالي")].map((h) => (
                        <th key={h} style={{ textAlign: "right", padding: "12px 16px", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERIODS.map((p) => {
                      const row = data.periods[p.id];
                      return (
                        <tr key={p.id} onClick={() => setPeriod(p.id)} style={{ cursor: "pointer", borderTop: "1px solid var(--border-soft)", fontSize: 13.5, background: p.id === period ? "var(--green-bg)" : undefined }}>
                          <td style={{ padding: "12px 16px", fontWeight: 700 }}>{p.label}</td>
                          <td className="tat-num" style={{ padding: "12px 16px", color: "var(--green)" }}>{formatMoney(row.confirmed, data.currency)}</td>
                          <td className="tat-num" style={{ padding: "12px 16px", color: "var(--orange)" }}>{formatMoney(row.expected, data.currency)}</td>
                          <td className="tat-num" style={{ padding: "12px 16px", color: "var(--red)" }}>{formatMoney(row.atRisk, data.currency)}</td>
                          <td className="tat-num" style={{ padding: "12px 16px", fontWeight: 700 }}>{formatMoney(totals[p.id], data.currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
