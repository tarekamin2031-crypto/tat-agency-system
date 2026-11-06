import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { INK } from "../theme";
import { api, setToken, setStoredUser, getStoredUser } from "../api/client";
import GlobalFilterBar from "./GlobalFilterBar";
import Toaster from "./Toaster";
import Icon from "./Icons";
import { visibleGroups } from "../utils/permissions";
import { getLang } from "../i18n";
import { useAccount } from "../context/AccountContext";
import { t } from "../i18n";

export default function Layout({ children }) {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const account = useAccount();
  const theme = account.prefs.theme || "dark";
  const collapsed = account.prefs.sidebar === "collapsed";

  const toggleTheme = () => account.updatePrefs({ theme: theme === "dark" ? "light" : "dark" }).catch(() => {});
  const toggleCollapsed = () => account.updatePrefs({ sidebar: collapsed ? "expanded" : "collapsed" }).catch(() => {});

  const toggleLang = () => account.updatePrefs({ language: getLang() === "ar" ? "en" : "ar" }).catch(() => {});

  const logout = () => {
    api.logout().catch(() => {}); // records the sign-out in the activity log; never blocks leaving
    setToken(null);
    setStoredUser(null);
    try { localStorage.removeItem("tat_prefs"); localStorage.removeItem("tat_lang"); } catch { /* ignore */ } // don't leak one user's defaults to the next login
    navigate("/login");
  };

  const groups = visibleGroups(account.me);
  const initial = (user?.name || "?").trim().charAt(0).toUpperCase();
  const isCollapsed = collapsed && !mobileOpen; // the mobile drawer is always full width

  return (
    <div style={{ fontFamily: "var(--font-sans)", minHeight: "100vh", color: INK, display: "flex" }}>
      <div className={`tat-overlay${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} />

      <aside className={`tat-sidebar${mobileOpen ? " open" : ""}${isCollapsed ? " collapsed" : ""}`}>
        <div className="tat-side-head">
          <img src={account.logoUrl || "/tat-logo-white.png"} alt={account.company?.name || "TAT Agency"} className="tat-side-logo" />
          {!isCollapsed && <div className="tat-tagline">{account.company?.tagline || "Social Media Agency"}</div>}
        </div>

        <nav className="tat-side-nav">
          {groups.map((group) => (
            <div key={group.label} className="tat-side-group">
              {isCollapsed ? <div className="tat-side-divider" /> : <div className="tat-side-label">{group.label}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={isCollapsed ? item.label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `tat-nav-item${isActive ? " active" : ""}`}
                >
                  <Icon name={item.icon} />
                  {!isCollapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="tat-side-foot">
          <NavLink to="/settings" className="tat-user" title={t("الإعدادات")} onClick={() => setMobileOpen(false)}>
            <div className="tat-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : initial}</div>
            {!isCollapsed && (
              <div className="tat-user-meta">
                <div className="tat-user-name">{account.profile?.name || user?.name}</div>
                <div className="tat-user-role">{account.me?.roleName ? t(account.me.roleName) : (user?.role === "admin" ? t("مدير") : t("عضو"))}</div>
              </div>
            )}
          </NavLink>
          <div className="tat-side-actions">
            <button className="tat-icon-btn" onClick={toggleTheme} title={theme === "dark" ? t("الوضع الفاتح") : t("الوضع الداكن")} aria-label={t("تبديل الوضع")}>
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <button className="tat-icon-btn" onClick={toggleLang} title={t("اللغة")} aria-label={t("اللغة")} style={{ fontSize: 12, fontWeight: 700 }}>
              {getLang() === "ar" ? "EN" : "ع"}
            </button>
            <button className="tat-icon-btn" onClick={logout} title={t("تسجيل الخروج")} aria-label={t("تسجيل الخروج")}>
              <Icon name="logout" />
            </button>
            <button className="tat-icon-btn tat-collapse-btn" onClick={toggleCollapsed} title={collapsed ? t("توسيع القائمة") : t("تصغير القائمة")} aria-label={t("تصغير القائمة")}>
              <Icon name={collapsed ? "expand" : "collapse"} />
            </button>
          </div>
        </div>
      </aside>

      <div className="tat-content" style={{ flex: 1, minWidth: 0, overflowY: "auto", height: "100vh" }}>
        <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <button className="tat-hamburger tat-icon-btn solid" onClick={() => setMobileOpen(true)} aria-label={t("فتح القائمة")}>
            <Icon name="menu" />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GlobalFilterBar />
          </div>
        </div>
        {children}
      </div>
      <Toaster />
    </div>
  );
}
