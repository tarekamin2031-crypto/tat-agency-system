import { t } from "../i18n";
// Single source of truth for the app's navigation — used by the sidebar and
// by the global search (so every page is reachable from the search box).
// `perm`: the user needs "view" on at least one of these modules to see the item.
export const NAV_GROUPS = [
  {
    get label() { return t("عام"); },
    items: [
      { to: "/dashboard", get label() { return t("لوحة القيادة"); }, icon: "dashboard", perm: ["dashboard"] },
      { to: "/alerts", get label() { return t("التنبيهات"); }, icon: "bell", perm: ["dashboard", "reports"] },
    ],
  },
  {
    get label() { return t("العملاء"); },
    items: [
      { to: "/clients", get label() { return t("العملاء"); }, icon: "users", perm: ["clients"] },
      { to: "/client-profitability", get label() { return t("ربحية العملاء"); }, icon: "trend", perm: ["reports"] },
      { to: "/client-health", get label() { return t("صحة العملاء"); }, icon: "pulse", perm: ["reports"] },
      { to: "/renewal-analytics", get label() { return t("تحليلات التجديد"); }, icon: "refresh", perm: ["reports"] },
    ],
  },
  {
    get label() { return t("المالية"); },
    items: [
      { to: "/invoices", get label() { return t("الفواتير والمصاريف"); }, icon: "invoice", perm: ["invoices", "expenses", "personal_expenses"] },
      { to: "/salaries", get label() { return t("رواتب الموظفين"); }, icon: "wallet", perm: ["expenses"] },
      { to: "/collection", get label() { return t("التحصيل والمدفوعات"); }, icon: "card", perm: ["collection"] },
      { to: "/ad-budgets", get label() { return t("إعلانات العملاء"); }, icon: "megaphone", perm: ["ad_budgets"] },
      { to: "/cash-flow-forecast", get label() { return t("توقعات التدفق النقدي"); }, icon: "activity", perm: ["reports"] },
    ],
  },
  {
    get label() { return t("التحليلات"); },
    items: [
      { to: "/service-analytics", get label() { return t("تحليل الخدمات"); }, icon: "pie", perm: ["reports"] },
      { to: "/manage-services", get label() { return t("إدارة الخدمات"); }, icon: "sliders", perm: ["services"] },
    ],
  },
];

export const ACCOUNT_GROUP = {
  get label() { return t("الحساب"); },
  items: [{ to: "/settings", get label() { return t("الإعدادات"); }, icon: "settings" }],
};

// Team + activity log: shown to anyone holding the matching permission.
export const ADMIN_GROUP = {
  get label() { return t("الإدارة"); },
  items: [
    { to: "/team", get label() { return t("الفريق والصلاحيات"); }, icon: "shield", perm: ["team"] },
    { to: "/logs", get label() { return t("سجل النشاط"); }, icon: "clock", perm: ["logs"] },
  ],
};

// Super-admin panel for the whole platform (all agencies).
export const PLATFORM_GROUP = {
  get label() { return t("إدارة المنصة"); },
  items: [
    { to: "/platform", get label() { return t("الوكالات"); }, icon: "table", platformOnly: true },
    { to: "/platform/logs", get label() { return t("سجل المنصة"); }, icon: "activity", platformOnly: true },
  ],
};
