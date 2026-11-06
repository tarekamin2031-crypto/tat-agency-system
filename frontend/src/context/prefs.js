// Per-user preferences live on the account (server) so they follow the user
// across devices; localStorage is only a fast cache so the first paint is right.
const CACHE_KEY = "tat_prefs";

export const FILTER_DEFAULTS = { dateRange: "this_month", clientStatus: "Active" };

export function readPrefsCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch { return {}; }
}

export function writePrefsCache(prefs) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(prefs || {})); } catch { /* private mode */ }
}

export function effectiveFilterDefaults(prefs = readPrefsCache()) {
  return { ...FILTER_DEFAULTS, ...(prefs.defaultFilters || {}) };
}

// Apply theme + sidebar immediately (and mirror them in the keys the shell reads at startup).
export function applyAppearance(prefs) {
  if (!prefs) return;
  try {
    if (prefs.theme) {
      document.documentElement.setAttribute("data-theme", prefs.theme);
      localStorage.setItem("tat_theme", prefs.theme);
    }
    if (prefs.sidebar) localStorage.setItem("tat_sidebar", prefs.sidebar);
  } catch { /* ignore */ }
}
