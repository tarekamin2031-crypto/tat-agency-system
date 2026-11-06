import React, { useEffect, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { NAVY, NAVY_SOFT, GOLD, TEAL, RED, GREEN, formatDateArabic, darken, PILL, tint } from "../theme";
import { EmptyBox, StatCard } from "../components/Bits";
import { t } from "../i18n";

const WINDOWS = [7, 30, 60, 90];

const CATEGORY_META = {
  Confirmed: { get label() { return t("مؤكد"); }, emoji: "🟢", color: GREEN },
  Pending: { get label() { return t("معلّق"); }, emoji: "🟡", color: GOLD },
  AtRisk: { get label() { return t("في خطر"); }, emoji: "🟠", color: "var(--orange)" },
  Expired: { get label() { return t("منتهي"); }, emoji: "🔴", color: RED },
};

export default function RenewalAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeWindow, setActiveWindow] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.renewalAnalytics();
      setData(result);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{t("تحليلات التجديد")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("العقود اللي هتتجدد قريب، ومعدل الاحتفاظ بالعملاء")}</div>
      </div>

      {loading || !data ? <EmptyBox>{t("جارٍ التحميل…")}</EmptyBox> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            <StatCard label={t("معدل الاحتفاظ بالعملاء")} value={`${data.renewalRate.toFixed(1)}%`} color={data.renewalRate >= 70 ? GREEN : data.renewalRate >= 40 ? GOLD : RED} />
            <StatCard label={t("عملاء نشطين")} value={data.activeCount} color={GREEN} />
            <StatCard label={t("عملاء متوقفين")} value={data.stoppedCount} color="var(--ink-3)" />
            <StatCard label={t("عقود منتهية")} value={data.expiredCount} color={RED} />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setActiveWindow(w)}
                style={{
                  padding: "8px 18px", borderRadius: 8, border: `1px solid ${activeWindow === w ? PILL : "var(--border)"}`,
                  background: activeWindow === w ? PILL : "var(--surface)", color: activeWindow === w ? "#fff" : "var(--ink-2)",
                  fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                }}
              >
                {t("خلال {w} يوم", { w })}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <StatCard key={key} label={meta.label} value={data.windows[activeWindow][key.charAt(0).toLowerCase() + key.slice(1)]} color={meta.color} />
            ))}
          </div>

          <div className="tat-card" style={{ overflow: "hidden" }}>
            <div style={{ background: "var(--surface-2)", color: "var(--ink-2)", padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>
              {t("العملاء اللي هيتجدد عقدهم خلال {activeWindow} يوم", { activeWindow })}
            </div>
            {data.windows[activeWindow].clients.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)" }}>{t("لا توجد تجديدات خلال هذه الفترة")}</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ fontSize: 12, color: "var(--ink-3)", borderBottom: "1px solid var(--border-soft)" }}>
                    <Th>{t("العميل")}</Th><Th>{t("تاريخ التجديد")}</Th><Th>{t("باقي")}</Th><Th>{t("التصنيف")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.windows[activeWindow].clients].sort((a, b) => a.daysUntil - b.daysUntil).map((c) => {
                    const meta = CATEGORY_META[c.category];
                    return (
                      <tr key={c.clientId} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                        <Td style={{ fontWeight: 600 }}>{c.clientName}</Td>
                        <Td>{formatDateArabic(c.target)}</Td>
                        <Td>{c.daysUntil}{" "}{t("يوم")}</Td>
                        <Td><span style={{ fontSize: 11.5, padding: "3px 10px", borderRadius: 20, background: tint(meta.color, 13), color: darken(meta.color) }}><span className="tat-dot" style={{ background: meta.color }} />{meta.label}</span></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children }) { return <th style={{ textAlign: "right", padding: "10px 12px", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children, style }) { return <td style={{ padding: "10px 12px", whiteSpace: "nowrap", ...style }}>{children}</td>; }
