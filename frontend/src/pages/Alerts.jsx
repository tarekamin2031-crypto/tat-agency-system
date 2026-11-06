import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { NAVY, GOLD, TEAL, RED, GREEN, formatMoney, formatDateArabic, darken, INK, tint } from "../theme";
import { EmptyBox, StatCard, FilterPills, Badge, LoadingBox } from "../components/Bits";
import Icon from "../components/Icons";
import { t } from "../i18n";

const TYPE_META = {
  OverduePayment: { get label() { return t("متأخر السداد"); }, icon: "banknote" },
  PaymentDueSoon: { get label() { return t("استحقاق قريب"); }, icon: "clock" },
  UpcomingRenewal: { get label() { return t("تجديد قريب"); }, icon: "refresh" },
  ContractExpiration: { get label() { return t("عقد محتاج قرار"); }, icon: "invoice" },
  HighOutstandingBalance: { get label() { return t("رصيد مرتفع"); }, icon: "trend" },
  ClientAtRisk: { get label() { return t("عميل في خطر"); }, icon: "bell" },
};

const SEVERITY_META = {
  high: { get label() { return t("عالية"); }, color: RED },
  medium: { get label() { return t("متوسطة"); }, color: GOLD },
  low: { get label() { return t("منخفضة"); }, color: TEAL },
};

// The server builds alert messages in Arabic; map the known shapes to the current language.
function translateAlert(msg) {
  const rules = [
    [/^فاتورة (\S+) متأخرة (\d+) يوم$/, (m) => t("فاتورة {n} متأخرة {d} يوم", { n: m[1], d: m[2] })],
    [/^فاتورة (\S+) مستحقة قريبًا$/, (m) => t("فاتورة {n} مستحقة قريبًا", { n: m[1] })],
    [/^عقد "(.+)" \(مرة واحدة\) هينتهي خلال (\d+) يوم — محتاج قرار تجديد يدوي$/, (m) => t('عقد "{c}" (مرة واحدة) هينتهي خلال {d} يوم — محتاج قرار تجديد يدوي', { c: m[1], d: m[2] })],
    [/^عقد "(.+)" هيتجدد تلقائيًا خلال (\d+) يوم$/, (m) => t('عقد "{c}" هيتجدد تلقائيًا خلال {d} يوم', { c: m[1], d: m[2] })],
    [/^رصيد مستحق مرتفع على "(.+)"$/, (m) => t('رصيد مستحق مرتفع على "{c}"', { c: m[1] })],
    [/^"(.+)" في خطر \(الدرجة: (\d+)\) — يحتاج متابعة فورية$/, (m) => t('"{c}" في خطر (الدرجة: {s}) — يحتاج متابعة فورية', { c: m[1], s: m[2] })],
  ];
  for (const [re, fn] of rules) { const m = String(msg).match(re); if (m) return fn(m); }
  return msg;
}

export default function Alerts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.alerts();
      setData(result);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.alerts.filter((a) => severityFilter === "all" || a.severity === severityFilter);
  }, [data, severityFilter]);

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{t("التنبيهات")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("كل حاجة محتاجة انتباهك في مكان واحد")}</div>
      </div>

      {loading || !data ? <LoadingBox rows={3} /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            <StatCard label={t("إجمالي التنبيهات")} value={data.total} color={INK} />
            <StatCard label={t("عالية الأهمية")} value={data.counts.high} color={RED} />
            <StatCard label={t("متوسطة")} value={data.counts.medium} color={GOLD} />
            <StatCard label={t("منخفضة")} value={data.counts.low} color={TEAL} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <FilterPills
              options={[
                { id: "all", get label() { return t("الكل"); } },
                { id: "high", get label() { return t("عالية"); }, color: RED },
                { id: "medium", get label() { return t("متوسطة"); }, color: GOLD },
                { id: "low", get label() { return t("منخفضة"); }, color: TEAL },
              ]}
              value={severityFilter}
              onChange={setSeverityFilter}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyBox>{t("لا توجد تنبيهات مطابقة")}</EmptyBox>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((a, i) => {
                const type = TYPE_META[a.type];
                const sev = SEVERITY_META[a.severity];
                return (
                  <div key={i} className="tat-row">
                    <span className="tat-ico" style={{ "--c": sev.color }}><Icon name={type.icon} size={19} /></span>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{translateAlert(a.message)}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                        {type.label}{a.date ? ` · ${formatDateArabic(a.date)}` : ""}
                      </div>
                    </div>
                    {a.amount !== null && a.amount !== undefined && (
                      <div className="tat-num" style={{ fontSize: 15, fontWeight: 700, color: sev.color }}>{formatMoney(a.amount, "EGP")}</div>
                    )}
                    <Badge color={sev.color}>{sev.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
