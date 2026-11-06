import { MONTHS, locale } from "./i18n";
// Colors are CSS variables (see styles/tokens.css) so every page follows the
// active theme (dark by default, light via the sidebar toggle). The brand
// accents keep the TAT palette in both themes.
export const NAVY = "#0A1A2E";          // fixed brand navy — for fills that must stay dark
export const NAVY_SOFT = "#0F2A3D";     // table-header / banner fill
export const INK = "var(--ink)";        // primary text (flips with the theme)
export const PILL = "var(--pill-active)"; // active tab / pill fill
export const CREAM = "var(--bg)";       // page background
export const GOLD = "var(--brand)";     // TAT brand green (primary action color)
export const TEAL = "var(--teal)";
export const RED = "var(--red)";
export const ORANGE = "var(--orange)";
export const GREEN = "var(--green)";

export const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 14.5,
  marginBottom: 4,
  background: "var(--input-bg)",
  color: INK,
  boxSizing: "border-box",
};

export function btnStyle(bg) {
  return {
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.25)",
  };
}

// Works with hex colors AND CSS variables. Used for text on a tinted badge:
// a darker shade in the light theme, a lighter one in the dark theme.
export function darken(color) {
  return `color-mix(in srgb, ${color || "#999"} 55%, var(--mix-target))`;
}

// A translucent version of any color (hex or CSS variable) — replaces the old
// `hex + "22"` alpha-suffix trick, which can't work with variables.
export function tint(color, percent = 13) {
  return `color-mix(in srgb, ${color || "#999"} ${percent}%, transparent)`;
}

export function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  return `${n.toLocaleString("en-US")} ${currency || ""}`;
}

const MONTHS_AR = MONTHS;
export function formatDateArabic(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return `${d.getDate()} ${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`;
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
