// Pure validation helpers for user / company settings (unit-tested).

const THEMES = ["dark", "light"];
const SIDEBAR_STATES = ["expanded", "collapsed"];
const DATE_RANGES = ["today", "this_week", "this_month", "last_month", "last_3_months", "last_6_months", "this_year", "last_year", "all"];
const CLIENT_STATUSES = ["all", "Active", "Suspended", "Stopped", "Expired"];
const DASHBOARD_WIDGETS = ["kpis", "profit", "trend", "clients", "cash", "distribution", "growth", "byService"];
const START_PAGES = [
  "/dashboard", "/alerts", "/clients", "/client-profitability", "/client-health", "/renewal-analytics",
  "/invoices", "/salaries", "/collection", "/ad-budgets", "/cash-flow-forecast", "/service-analytics", "/manage-services",
];

// Keeps only known keys with allowed values — anything else is dropped, so a
// client can never stash arbitrary data in the preferences column.
const LANGUAGES = ["ar", "en"];
function sanitizePreferences(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  if (THEMES.includes(src.theme)) out.theme = src.theme;
  if (SIDEBAR_STATES.includes(src.sidebar)) out.sidebar = src.sidebar;
  if (START_PAGES.includes(src.startPage)) out.startPage = src.startPage;
  if (LANGUAGES.includes(src.language)) out.language = src.language;
  if (Array.isArray(src.dashboardWidgets)) {
    out.dashboardWidgets = [...new Set(src.dashboardWidgets.filter((w) => DASHBOARD_WIDGETS.includes(w)))];
  }
  const df = src.defaultFilters && typeof src.defaultFilters === "object" ? src.defaultFilters : null;
  if (df) {
    const filters = {};
    if (DATE_RANGES.includes(df.dateRange)) filters.dateRange = df.dateRange;
    if (CLIENT_STATUSES.includes(df.clientStatus)) filters.clientStatus = df.clientStatus;
    if (Object.keys(filters).length) out.defaultFilters = filters;
  }
  return out;
}

const MIN_PASSWORD_LENGTH = 8;
function validateNewPassword(newPassword, currentPassword) {
  const p = String(newPassword || "");
  if (p.length < MIN_PASSWORD_LENGTH) return `كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} حروف على الأقل`;
  if (p === String(currentPassword || "")) return "كلمة المرور الجديدة لازم تكون مختلفة عن الحالية";
  if (!/[A-Za-z؀-ۿ]/.test(p) || !/\d/.test(p)) return "كلمة المرور لازم تحتوي على حروف وأرقام";
  return null;
}

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
// data: "data:image/png;base64,...." or raw base64 + mime. Returns { buffer, mime } or { error }.
function parseImageUpload(dataUrl, maxBytes) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) return { error: "ملف الصورة غير صالح" };
  const mime = m[1].toLowerCase();
  if (!IMAGE_MIMES.includes(mime)) return { error: "الصورة لازم تكون PNG أو JPG أو WebP" };
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length) return { error: "ملف الصورة فاضي" };
  if (buffer.length > maxBytes) return { error: `حجم الصورة أكبر من ${Math.round(maxBytes / 1024)} كيلوبايت` };
  return { buffer, mime };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

// Company settings: returns { values, error }. Only provided keys are returned.
function sanitizeCompany(input) {
  const src = input || {};
  const values = {};
  const str = (k, max) => { if (src[k] !== undefined) values[k] = String(src[k] ?? "").trim().slice(0, max) || null; };
  if (src.name !== undefined) {
    const name = String(src.name).trim();
    if (!name) return { error: "اسم الشركة مطلوب" };
    values.name = name.slice(0, 200);
  }
  if (src.tagline !== undefined) values.tagline = String(src.tagline).trim().slice(0, 200) || "";
  str("email", 150); str("phone", 50); str("address", 1000); str("tax_number", 80); str("invoice_footer", 1000);
  if (values.email && !validateEmail(values.email)) return { error: "إيميل الشركة غير صالح" };
  if (src.default_commission_rate !== undefined) {
    const r = Number(src.default_commission_rate);
    if (!Number.isFinite(r) || r < 0 || r > 100) return { error: "نسبة العمولة لازم تكون بين 0 و100" };
    values.default_commission_rate = Math.round(r * 100) / 100;
  }
  if (src.invoice_prefix !== undefined) {
    const p = String(src.invoice_prefix).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(p)) return { error: "بادئة الفواتير: حروف إنجليزية وأرقام فقط (حتى 10)" };
    values.invoice_prefix = p;
  }
  return { values };
}

module.exports = { sanitizePreferences, validateNewPassword, parseImageUpload, validateEmail, sanitizeCompany, MIN_PASSWORD_LENGTH };
