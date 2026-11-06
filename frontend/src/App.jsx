import React, { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import ResetPassword, { ForgotPassword } from "./pages/ResetPassword";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { FilterProvider } from "./context/FilterContext";
import { AccountProvider } from "./context/AccountContext";
import { readPrefsCache } from "./context/prefs";
import { getStoredUser } from "./api/client";
import { getLang, onLanguageChange, t } from "./i18n";
import { canAny, firstAllowedPath } from "./utils/permissions";

// Every protected page is lazy-loaded so the initial bundle only contains
// the login screen + shell — each page's code loads on first visit only.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Clients = lazy(() => import("./pages/Clients"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Salaries = lazy(() => import("./pages/Salaries"));
const Collection = lazy(() => import("./pages/Collection"));
const AdBudgets = lazy(() => import("./pages/AdBudgets"));
const ClientProfitability = lazy(() => import("./pages/ClientProfitability"));
const ServiceAnalytics = lazy(() => import("./pages/ServiceAnalytics"));
const ManageServices = lazy(() => import("./pages/ManageServices"));
const ClientHealth = lazy(() => import("./pages/ClientHealth"));
const RenewalAnalytics = lazy(() => import("./pages/RenewalAnalytics"));
const CashFlowForecast = lazy(() => import("./pages/CashFlowForecast"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Team = lazy(() => import("./pages/Team"));
const Settings = lazy(() => import("./pages/Settings"));
const Logs = lazy(() => import("./pages/Logs"));
const Platform = lazy(() => import("./pages/Platform"));
const PlatformLogs = lazy(() => import("./pages/PlatformLogs"));

// Which modules unlock each page (kept in sync with components/navItems.js).
const ROUTE_PERMS = {
  "/dashboard": ["dashboard"], "/alerts": ["dashboard", "reports"], "/clients": ["clients"],
  "/client-profitability": ["reports"], "/client-health": ["reports"], "/renewal-analytics": ["reports"],
  "/invoices": ["invoices", "expenses", "personal_expenses"], "/salaries": ["expenses"], "/collection": ["collection"],
  "/ad-budgets": ["ad_budgets"], "/cash-flow-forecast": ["reports"], "/service-analytics": ["reports"], "/manage-services": ["services"],
};

function PageFallback() {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontFamily: "var(--font-sans)" }}>
      {t("جارٍ التحميل…")}
    </div>
  );
}

function NoAccess() {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>{t("مفيش عندك صلاحية للصفحة دي")}</div>
      <div style={{ fontSize: 13 }}>{t("لو محتاجها، اطلب من مدير الوكالة يضيفها لدورك.")}</div>
    </div>
  );
}

// `perm`: modules of which the user needs "view" on at least one; `platform`: super admin only.
function Protected({ children, perm, platform }) {
  const user = getStoredUser();
  const allowed = platform ? !!(user && user.isPlatformAdmin) : canAny(user, perm);
  return (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<PageFallback />}>{allowed ? children : <NoAccess />}</Suspense>
      </Layout>
    </ProtectedRoute>
  );
}

// Unknown URLs land on the user's chosen start page (Settings → Preferences).
function StartRedirect() {
  const user = getStoredUser();
  const wanted = readPrefsCache().startPage;
  // Only honour the chosen start page if this role may open it.
  const startItem = wanted && ["/dashboard","/alerts","/clients","/invoices","/salaries","/collection","/ad-budgets","/cash-flow-forecast","/service-analytics","/manage-services","/client-profitability","/client-health","/renewal-analytics"].includes(wanted);
  const target = startItem && ROUTE_PERMS[wanted] && canAny(user, ROUTE_PERMS[wanted]) ? wanted : firstAllowedPath(user);
  return <Navigate to={target} replace />;
}

// "/" is the public landing page; signed-in users go to their own start page instead.
function Home() {
  let signedIn = false;
  try { signedIn = !!localStorage.getItem("tat_token"); } catch { /* ignore */ }
  return signedIn ? <StartRedirect /> : <Landing />;
}

export default function App() {
  // switching language remounts the page tree so every t() call re-runs
  const [lang, setLang] = useState(getLang());
  useEffect(() => onLanguageChange(setLang), []);
  return (
    <BrowserRouter>
      <FilterProvider>
        <AccountProvider>
        <Routes key={lang}>
          <Route path="/" element={<Home />} />
          <Route path="/welcome" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/dashboard" element={<Protected perm={["dashboard"]}><Dashboard /></Protected>} />
          <Route path="/clients" element={<Protected perm={["clients"]}><Clients /></Protected>} />
          <Route path="/invoices" element={<Protected perm={["invoices", "expenses", "personal_expenses"]}><Invoices /></Protected>} />
          <Route path="/salaries" element={<Protected perm={["expenses"]}><Salaries /></Protected>} />
          <Route path="/collection" element={<Protected perm={["collection"]}><Collection /></Protected>} />
          <Route path="/ad-budgets" element={<Protected perm={["ad_budgets"]}><AdBudgets /></Protected>} />
          <Route path="/payment-center" element={<Navigate to="/collection" replace />} />
          <Route path="/client-profitability" element={<Protected perm={["reports"]}><ClientProfitability /></Protected>} />
          <Route path="/service-analytics" element={<Protected perm={["reports"]}><ServiceAnalytics /></Protected>} />
          <Route path="/manage-services" element={<Protected perm={["services"]}><ManageServices /></Protected>} />
          <Route path="/client-health" element={<Protected perm={["reports"]}><ClientHealth /></Protected>} />
          <Route path="/renewal-analytics" element={<Protected perm={["reports"]}><RenewalAnalytics /></Protected>} />
          <Route path="/cash-flow-forecast" element={<Protected perm={["reports"]}><CashFlowForecast /></Protected>} />
          <Route path="/alerts" element={<Protected perm={["dashboard", "reports"]}><Alerts /></Protected>} />
          <Route path="/team" element={<Protected perm={["team"]}><Team /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/logs" element={<Protected perm={["logs"]}><Logs /></Protected>} />
          <Route path="/platform" element={<Protected platform><Platform /></Protected>} />
          <Route path="/platform/logs" element={<Protected platform><PlatformLogs /></Protected>} />
          <Route path="*" element={<StartRedirect />} />
        </Routes>
        </AccountProvider>
      </FilterProvider>
    </BrowserRouter>
  );
}
