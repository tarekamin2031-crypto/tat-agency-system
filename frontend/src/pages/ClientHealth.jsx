import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { NAVY, NAVY_SOFT, GOLD, TEAL, RED, GREEN, inputStyle, formatMoney, darken } from "../theme";
import { EmptyBox, FilterPills, StatCard, Badge, LoadingBox } from "../components/Bits";
import { t } from "../i18n";

const CATEGORY_META = {
  Healthy: { get label() { return t("سليم"); }, emoji: "🟢", color: GREEN },
  NeedsAttention: { get label() { return t("محتاج متابعة"); }, emoji: "🟡", color: GOLD },
  AtRisk: { get label() { return t("في خطر"); }, emoji: "🔴", color: RED },
};

export default function ClientHealth() {
  const filters = useFilters();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.clientHealth(filters.toQueryString());
      setRows(data);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (search.trim() && !r.clientName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, categoryFilter, search]);

  const summary = useMemo(() => {
    const counts = { Healthy: 0, NeedsAttention: 0, AtRisk: 0 };
    rows.forEach((r) => { counts[r.category]++; });
    return counts;
  }, [rows]);

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{t("تقييم صحة العملاء")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("مقياس من 0 إلى 100 يجمع سلوك الدفع، المستحقات، التأخير، الولاء، والقيمة")}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatCard icon="checkCircle" label={t("سليم")} value={summary.Healthy} color={GREEN} />
        <StatCard icon="clock" label={t("محتاج متابعة")} value={summary.NeedsAttention} color={GOLD} />
        <StatCard icon="bell" label={t("في خطر")} value={summary.AtRisk} color={RED} />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ابحث بالعميل...")} style={{ ...inputStyle, width: 200, marginBottom: 0 }} />
        <FilterPills
          options={[{ id: "all", get label() { return t("الكل"); } }, ...Object.entries(CATEGORY_META).map(([id, v]) => ({ id, label: v.label, color: v.color }))]}
          value={categoryFilter}
          onChange={setCategoryFilter}
        />
      </div>

      {loading ? <LoadingBox rows={3} /> : filtered.length === 0 ? <EmptyBox>{t("لا يوجد عملاء مطابقين")}</EmptyBox> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => {
            const meta = CATEGORY_META[r.category];
            const isOpen = expanded === r.clientId;
            return (
              <div key={r.clientId} className="tat-card" style={{ overflow: "hidden" }}>
                <div
                  onClick={() => setExpanded(isOpen ? null : r.clientId)}
                  style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", cursor: "pointer" }}
                >
                  <div className="tat-num" style={{ width: 54, height: 54, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, fontWeight: 700, color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.color} 25%, transparent)`, flexShrink: 0 }}>{r.score}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{r.clientName}</div>
                    <div style={{ marginTop: 4 }}><Badge color={meta.color}>{meta.label}</Badge></div>
                  </div>
                  <div style={{ width: 140, height: 8, background: "var(--surface-2)", borderRadius: 9999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${r.score}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${meta.color} 70%, transparent), ${meta.color})`, borderRadius: 9999 }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 90, textAlign: "left" }}>
                    {r.maxDaysOverdue > 0 ? t("متأخر {maxDaysOverdue} يوم", { maxDaysOverdue: r.maxDaysOverdue }) : "—"}
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: "0 18px 16px", borderTop: "1px solid var(--border-soft)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 14 }}>
                      <BreakdownItem label={t("سلوك الدفع")} value={r.breakdown.paymentScore} max={30} />
                      <BreakdownItem label={t("المستحقات")} value={r.breakdown.outstandingScore} max={20} />
                      <BreakdownItem label={t("شدة التأخير")} value={r.breakdown.overdueScore} max={20} />
                      <BreakdownItem label={t("مدة العلاقة")} value={r.breakdown.tenureScore} max={10} />
                      <BreakdownItem label={t("قيمة العميل")} value={r.breakdown.valueScore} max={10} />
                      <BreakdownItem label={t("حالة العميل")} value={r.breakdown.statusScore} max={10} />
                    </div>
                    <div style={{ display: "flex", gap: 20, marginTop: 14, fontSize: 12.5 }}>
                      <span>{t("الإيرادات:")}{" "}<strong>{formatMoney(r.revenue, "EGP")}</strong></span>
                      <span>{t("المحصّل:")}{" "}<strong style={{ color: GREEN }}>{formatMoney(r.cashCollected, "EGP")}</strong></span>
                      <span>{t("المستحق:")}{" "}<strong style={{ color: r.outstandingBalance > 0 ? GOLD : "var(--ink-3)" }}>{formatMoney(r.outstandingBalance, "EGP")}</strong></span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BreakdownItem({ label, value, max }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--ink-3)", marginBottom: 3 }}>
        <span>{label}</span>
        <span>{value}/{max}</span>
      </div>
      <div style={{ height: 6, background: "var(--border-soft)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(value / max) * 100}%`, background: TEAL }} />
      </div>
    </div>
  );
}
