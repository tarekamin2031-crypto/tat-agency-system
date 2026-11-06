import React from "react";

// Small building blocks shared by the settings-style screens (email, webhooks, platform).
export function Section({ title, hint, children, footer }) {
  return (
    <div className="tat-card" style={{ padding: 24, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>{hint}</div>}
      <div style={{ marginTop: 16 }}>{children}</div>
      {footer && <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{footer}</div>}
    </div>
  );
}

export function Row({ children, min = 220 }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: "4px 16px" }}>{children}</div>;
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, padding: "6px 0" }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 17, height: 17, marginTop: 2, accentColor: "var(--brand)", flex: "0 0 auto" }} />
      <span>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>{hint}</span>}
      </span>
    </label>
  );
}

export const fmtDateTime = (iso, locale) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
};
