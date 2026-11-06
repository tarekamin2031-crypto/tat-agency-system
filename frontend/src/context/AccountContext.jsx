import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, fetchBlobUrl, getStoredUser, getToken, setStoredUser } from "../api/client";
import { hasPerm } from "../utils/permissions";
import { getLang, setLanguage } from "../i18n";
import { useFilters } from "./FilterContext";
import { applyAppearance, readPrefsCache, writePrefsCache } from "./prefs";

// Holds everything that belongs to the signed-in account: profile, avatar,
// preferences (theme / sidebar / default filters / start page) and the
// company details shown in the shell. Mounted once above the routes, so the
// data is fetched once per session — not on every page change.
const AccountContext = createContext(null);

function initialPrefs() {
  const cache = readPrefsCache();
  let theme, sidebar;
  try { theme = localStorage.getItem("tat_theme") || undefined; sidebar = localStorage.getItem("tat_sidebar") || undefined; } catch { /* ignore */ }
  return { ...(theme ? { theme } : {}), ...(sidebar ? { sidebar } : {}), ...cache };
}

export function AccountProvider({ children }) {
  const filters = useFilters();
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [profile, setProfile] = useState(null);
  const [company, setCompany] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [prefs, setPrefs] = useState(initialPrefs);
  const urls = useRef({ avatar: null, logo: null });

  const swapUrl = (kind, next, setter) => {
    if (urls.current[kind]) URL.revokeObjectURL(urls.current[kind]);
    urls.current[kind] = next;
    setter(next);
  };

  const refreshCompany = useCallback(async () => {
    try {
      const c = await api.getCompany();
      setCompany(c);
      document.title = `${c.name} System`;
      swapUrl("logo", c.has_logo ? await fetchBlobUrl(`/settings/company/logo?t=${Date.now()}`) : null, setLogoUrl);
    } catch { /* the shell falls back to the bundled logo */ }
  }, []);

  const refreshAvatar = useCallback(async (hasAvatar) => {
    swapUrl("avatar", hasAvatar ? await fetchBlobUrl(`/auth/me/avatar?t=${Date.now()}`) : null, setAvatarUrl);
  }, []);

  const refresh = useCallback(async ({ applyFilters = true } = {}) => {
    if (!getToken()) return null;
    try {
      const { user } = await api.me();
      setProfile(user);
      setStoredUser({
        id: user.id, name: user.name, email: user.email, role: user.role, roleName: user.roleName,
        permissions: user.permissions, isAgencyAdmin: user.isAgencyAdmin, isPlatformAdmin: user.isPlatformAdmin, agency: user.agency,
      });
      const server = user.preferences || {};
      // language: the user's own choice, else the agency default, else keep what's showing
      let chosenHere = null;
      try { chosenHere = localStorage.getItem("tat_lang"); } catch { /* ignore */ }
      const lang = server.language || chosenHere || (user.agency && user.agency.default_language) || getLang();
      setLanguage(lang);
      server.language = lang;
      setPrefs((prev) => ({ ...prev, ...server }));
      writePrefsCache({ ...readPrefsCache(), ...server });
      applyAppearance(server);
      if (applyFilters) filtersRef.current.applyDefaults(server);
      refreshAvatar(user.has_avatar);
      refreshCompany();
      return user;
    } catch {
      return null;
    }
  }, [refreshAvatar, refreshCompany]);

  useEffect(() => { refresh(); }, [refresh]);

  // Save preferences to the account (and apply them right away).
  const updatePrefs = useCallback(async (partial) => {
    const next = {
      ...prefs, ...partial,
      ...(partial.defaultFilters ? { defaultFilters: { ...(prefs.defaultFilters || {}), ...partial.defaultFilters } } : {}),
    };
    setPrefs(next);
    writePrefsCache(next);
    applyAppearance(partial);
    if (partial.language) setLanguage(partial.language);
    if (partial.defaultFilters) filtersRef.current.applyDefaults(next);
    await api.savePreferences(partial);
  }, [prefs]);

  // Permissions come from the live profile; until it loads we use what login stored.
  const stored = getStoredUser();
  const me = profile || stored;
  const can = useCallback((module, action = "view") => hasPerm(me && me.permissions, module, action), [me]);

  const value = {
    profile, company, avatarUrl, logoUrl, prefs, refresh, refreshCompany, updatePrefs,
    me, can, isPlatformAdmin: !!(me && me.isPlatformAdmin), agency: (me && me.agency) || null,
  };
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside an AccountProvider");
  return ctx;
}
