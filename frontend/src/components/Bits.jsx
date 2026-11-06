import React from "react";
import { INK } from "../theme";
import Icon from "./Icons";
import { t } from "../i18n";


// Strips emoji / pictographs (cards and pills use colored dots + icons instead).
export function stripEmoji(text) {
  return String(text ?? "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{FE0F}]/gu, "").replace(/\s{2,}/g, " ").trim();
}

// Picks a fitting icon for a KPI from its label, so every card gets the same
// icon-chip treatment without each page naming one.
const ICON_RULES = [
  [/تنبيه|عالية|متوسطة|منخفضة|خطر/, "bell"],
  [/عمول|إعلان/, "megaphone"],
  [/مصروف|مصاريف/, "receipt"],
  [/راتب|رواتب|نقد|رصيد|سيولة/, "wallet"],
  [/متأخر|مستحق|متبقي|استحقاق|معلّق|معلق|غير مدفوع/, "clock"],
  [/محصّل|محصل|مدفوع|مؤكد|سليم|نشط|ساري|منتهي/, "checkCircle"],
  [/ربح|هامش|نمو/, "trend"],
  [/عميل|عملاء|عقود|عقد|متوقف/, "users"],
  [/فاتور/, "invoice"],
  [/تجديد/, "refresh"],
  [/إيراد|مطلوب|قيمة|إجمالي|متوقع|مبلغ/, "banknote"],
];
export function inferIcon(label) {
  const l = String(label || "");
  const hit = ICON_RULES.find(([re]) => re.test(l));
  return hit ? hit[1] : "chart";
}

/** Small colored status dot (replaces the old 🟢🟡🔴 emoji). */
export function Dot({ color }) {
  return <span className="tat-dot" style={{ background: color }} />;
}

/** Pill with a leading colored dot: <Badge color={RED}>{t("متأخرة")}</Badge> */
export function Badge({ color, children }) {
  return (
    <span className="tat-badge" style={{ "--c": color }}>
      <span className="tat-dot" style={{ background: color }} />{children}
    </span>
  );
}

// Percentage change pill ("▲ 15.5%"). `pct` null = no comparable previous value.
// invert: for things where going up is bad (expenses) the colors flip.
export function Delta({ pct, invert = false }) {
  if (pct === null || pct === undefined) return <span className="tat-delta flat">{t("جديد")}</span>;
  if (Math.abs(pct) < 0.05) return <span className="tat-delta flat" dir="ltr">0%</span>;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <span className={`tat-delta ${good ? "good" : "bad"}`} dir="ltr">
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/**
 * KPI card. Plain usage (label/value/color) keeps the compact colored-number
 * look used across the app; adding `icon` switches to the richer layout:
 * tinted icon chip, ink-colored number, optional change pill and a muted
 * "vs previous period" line.
 */
export function StatCard({ label, value, color, icon, delta, sub }) {
  const cleanLabel = stripEmoji(label);
  const iconName = icon || inferIcon(cleanLabel);
  return (
    <div className="tat-card lift" style={{ position: "relative", overflow: "hidden", padding: "16px 18px", height: "100%", boxSizing: "border-box" }}>
      <div className="tat-stat-head">
        <div className="tat-label">{cleanLabel}</div>
        <span className="tat-ico" style={{ "--c": color || INK }}><Icon name={iconName} size={17} /></span>
      </div>
      <div className="tat-stat-main">
        <div className="tat-num" style={{ fontSize: 24, fontWeight: 700, color: INK }}>{value}</div>
        {delta && <Delta pct={delta.pct} invert={delta.invert} />}
      </div>
      {sub && <div className="tat-stat-sub">{sub}</div>}
    </div>
  );
}

export function EmptyBox({ children }) {
  return (
    <div className="tat-card" style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>
      {children}
    </div>
  );
}

export function FilterPills({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            fontSize: 12.5, padding: "6px 14px", borderRadius: 9999, fontWeight: 500,
            border: `1px solid ${value === o.id ? "var(--tat-green)" : "var(--border)"}`,
            background: value === o.id ? "var(--tat-green)" : "var(--surface)", color: value === o.id ? "#fff" : "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          {o.color && <span className="tat-dot" style={{ background: o.color }} />}{stripEmoji(o.label)}
        </button>
      ))}
    </div>
  );
}

export function InfoBlock({ label, value }) {
  return (
    <div>
      <div className="tat-label">{label}</div>
      <div style={{ fontSize: 13.5 }}>{value}</div>
    </div>
  );
}

export function LoadingBox({ rows = 3 }) {
  return (
    <div style={{ display: "grid", gap: 12 }} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="tat-skeleton" style={{ height: 72 }} />
      ))}
    </div>
  );
}
