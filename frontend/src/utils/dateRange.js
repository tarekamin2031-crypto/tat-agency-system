// Mirrors backend/src/utils/dateRange.js so the date pill can show the exact
// period the filter will apply (e.g. "1 نوفمبر 2026 – 6 نوفمبر 2026").
import { t, MONTHS } from "../i18n";

const MONTHS_AR = MONTHS;

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());

export function resolveRange(range, customFrom, customTo, now = new Date()) {
  switch (range) {
    case "today": return { from: iso(now), to: iso(now) };
    case "this_week": { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); return { from: iso(s), to: iso(now) }; }
    case "this_month": return { from: iso(startOfMonth(now)), to: iso(now) };
    case "last_month": { const lm = addMonths(now, -1); return { from: iso(startOfMonth(lm)), to: iso(endOfMonth(lm)) }; }
    case "last_3_months": return { from: iso(startOfMonth(addMonths(now, -3))), to: iso(now) };
    case "last_6_months": return { from: iso(startOfMonth(addMonths(now, -6))), to: iso(now) };
    case "this_year": return { from: `${now.getFullYear()}-01-01`, to: iso(now) };
    case "this_quarter": { const q = Math.floor(now.getMonth() / 3); return { from: iso(new Date(now.getFullYear(), q * 3, 1)), to: iso(now) }; }
    case "last_year": return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` };
    case "custom": return { from: customFrom || null, to: customTo || null };
    default: return { from: null, to: null };
  }
}

function fmt(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS_AR[m - 1]} ${y}`;
}

export function rangeText(range, customFrom, customTo, now = new Date()) {
  const { from, to } = resolveRange(range, customFrom, customTo, now);
  if (!from && !to) return range === "custom" ? t("اختر المدى") : t("كل الفترات");
  if (from && to) return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  return from ? t("من {d}", { d: fmt(from) }) : t("حتى {d}", { d: fmt(to) });
}

const parseISO = (v) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); };
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export function describeRange(from, to) {
  if (!from || !to) return "";
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

/**
 * The period to compare against. Month-to-date and year-to-date compare with
 * the same stretch of the previous month/year; "last month/year" compare with
 * the one before; any other range compares with the same number of days right
 * before it. Returns null for "all time" (nothing to compare with).
 */
export function previousRange(range, customFrom, customTo, now = new Date()) {
  const cur = resolveRange(range, customFrom, customTo, now);
  if (!cur.from || !cur.to) return null;
  const f = parseISO(cur.from);
  const t = parseISO(cur.to);
  if (range === "this_month") {
    const pm = new Date(f.getFullYear(), f.getMonth() - 1, 1);
    const end = Math.min(t.getDate(), daysInMonth(pm.getFullYear(), pm.getMonth()));
    return { from: iso(pm), to: iso(new Date(pm.getFullYear(), pm.getMonth(), end)) };
  }
  if (range === "this_year") {
    const y = f.getFullYear() - 1;
    const end = Math.min(t.getDate(), daysInMonth(y, t.getMonth()));
    return { from: `${y}-01-01`, to: iso(new Date(y, t.getMonth(), end)) };
  }
  if (range === "last_month") {
    const pm = new Date(f.getFullYear(), f.getMonth() - 1, 1);
    return { from: iso(pm), to: iso(endOfMonth(pm)) };
  }
  if (range === "last_year") {
    const y = f.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const days = Math.round((t - f) / 86400000) + 1;
  const pTo = new Date(f); pTo.setDate(pTo.getDate() - 1);
  const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - (days - 1));
  return { from: iso(pFrom), to: iso(pTo) };
}

// % change of cur vs prev. null when there is nothing meaningful to compare.
export function pctChange(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (p === 0) return c === 0 ? 0 : null;
  return ((c - p) / Math.abs(p)) * 100;
}
