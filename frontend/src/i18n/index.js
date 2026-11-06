// Lightweight i18n. The Arabic source text IS the key: t("حفظ") returns "حفظ" in
// Arabic and the English dictionary entry ("Save") in English. A missing English
// entry falls back to the Arabic text (and is reported once in the dev console),
// so a half-translated screen never breaks.
//
// `lang` is module-level state read at call time. Switching language notifies the
// app, which remounts the page tree so every t() call re-runs.
import en from "./en";

const STORE_KEY = "tat_lang";
const LANGS = ["ar", "en"];
const listeners = new Set();
const reported = new Set();

function initial() {
  try { const v = localStorage.getItem(STORE_KEY); if (LANGS.includes(v)) return v; } catch { /* ignore */ }
  return "ar";
}

let lang = initial();

function applyDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
applyDocument();

export const getLang = () => lang;
export const isRTL = () => lang === "ar";
export const dirAttr = () => (lang === "ar" ? "rtl" : "ltr");
// Latin digits in both languages (the app always showed Western numerals).
export const locale = () => (lang === "ar" ? "ar-u-nu-latn" : "en-US");

const MONTHS_AR_LIST = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN_LIST = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthNames = () => (lang === "ar" ? MONTHS_AR_LIST : MONTHS_EN_LIST);
// Array-like view of the month names that follows the current language, so the
// old `MONTHS_AR[i]` / `MONTHS_AR.map(...)` code keeps working unchanged.
export const MONTHS = new Proxy([], {
  get: (_, prop) => Reflect.get(monthNames(), prop),
  has: (_, prop) => prop in monthNames(),
});

export function setLanguage(next) {
  const l = LANGS.includes(next) ? next : "ar";
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(STORE_KEY, l); } catch { /* ignore */ }
  applyDocument();
  listeners.forEach((fn) => fn(l));
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars) {
  if (key === null || key === undefined) return "";
  const raw = String(key);
  // keep the surrounding whitespace of JSX text exactly as written
  const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  let out = core;
  if (lang === "en") {
    const hit = en[core];
    if (hit === undefined) {
      if (import.meta.env && import.meta.env.DEV && !reported.has(core)) {
        reported.add(core);
        console.debug("[i18n] missing en:", core);
      }
    } else out = hit;
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  return m[1] + out + m[3];
}
