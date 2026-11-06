import { t, getLang } from "../i18n";

// Same-origin "/api" by default (Docker/nginx). On Vercel set VITE_API_URL=https://your-backend.example.com at build time.
const API_BASE = `${(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")}/api`;

export function getToken() {
  return localStorage.getItem("tat_token");
}

export function setToken(token) {
  if (token) localStorage.setItem("tat_token", token);
  else localStorage.removeItem("tat_token");
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("tat_user") || "null");
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) localStorage.setItem("tat_user", JSON.stringify(user));
  else localStorage.removeItem("tat_user");
}

export function notifyError(err) {
  const message = (err && err.message) || t("حدث خطأ غير متوقع");
  window.dispatchEvent(new CustomEvent("tat:toast", { detail: { type: "error", message } }));
}

export function notifySuccess(message) {
  window.dispatchEvent(new CustomEvent("tat:toast", { detail: { type: "success", message } }));
}

// Server messages are Arabic; known ones are translated, "فشل الإرسال: <reason>" keeps its dynamic tail.
function translateServerError(msg) {
  const m = /^فشل الإرسال: (.*)$/.exec(msg);
  return m ? t("فشل الإرسال: {e}", { e: m[1] }) : t(msg);
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    setStoredUser(null);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data && data.error ? translateServerError(data.error) : t("تعذر تنفيذ الطلب (خطأ {status})", { status: res.status }));
  }
  return data;
}

// Fetch an authenticated image (avatar / logo) as an object URL for <img src>.
export async function fetchBlobUrl(path) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

export const api = {
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  me: () => request("/auth/me"),
  listUsers: () => request("/auth/users"),
  createUser: (payload) => request("/auth/users", { method: "POST", body: payload }),
  updateMe: (payload) => request("/auth/me", { method: "PATCH", body: payload }),
  savePreferences: (preferences) => request("/auth/me/preferences", { method: "PUT", body: { preferences } }),
  changePassword: (payload) => request("/auth/me/password", { method: "POST", body: payload }),
  logoutAll: () => request("/auth/me/logout-all", { method: "POST" }),
  uploadAvatar: (data) => request("/auth/me/avatar", { method: "POST", body: { data } }),
  deleteAvatar: () => request("/auth/me/avatar", { method: "DELETE" }),
  getCompany: () => request("/settings/company"),
  updateCompany: (payload) => request("/settings/company", { method: "PUT", body: payload }),
  uploadCompanyLogo: (data) => request("/settings/company/logo", { method: "POST", body: { data } }),
  deleteCompanyLogo: () => request("/settings/company/logo", { method: "DELETE" }),
  updateUser: (id, payload) => request(`/auth/users/${id}`, { method: "PATCH", body: payload }),
  logout: () => request("/auth/logout", { method: "POST" }),
  forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: { email } }),
  resetPassword: (token, new_password) => request("/auth/reset-password", { method: "POST", body: { token, new_password } }),

  // email
  emailSettings: () => request("/email/settings"),
  saveEmailSettings: (payload) => request("/email/settings", { method: "PUT", body: payload }),
  deleteEmailSettings: () => request("/email/settings", { method: "DELETE" }),
  testEmail: (payload) => request("/email/test", { method: "POST", body: payload }),
  emailLog: () => request("/email/log"),
  platformEmail: () => request("/platform/email"),
  platformSaveEmail: (payload) => request("/platform/email", { method: "PUT", body: payload }),
  platformTestEmail: (payload) => request("/platform/email/test", { method: "POST", body: payload }),

  // marketing site (public) + leads inbox (platform admin)
  sendContact: (payload) => request("/public/contact", { method: "POST", body: payload }),
  platformLeads: (status = "") => request(`/platform/leads${status ? `?status=${status}` : ""}`),
  platformUpdateLead: (id, payload) => request(`/platform/leads/${id}`, { method: "PATCH", body: payload }),
  platformDeleteLead: (id) => request(`/platform/leads/${id}`, { method: "DELETE" }),

  // webhooks
  webhookEvents: () => request("/webhooks/events"),
  listWebhooks: () => request("/webhooks"),
  createWebhook: (payload) => request("/webhooks", { method: "POST", body: payload }),
  updateWebhook: (id, payload) => request(`/webhooks/${id}`, { method: "PUT", body: payload }),
  deleteWebhook: (id) => request(`/webhooks/${id}`, { method: "DELETE" }),
  rotateWebhook: (id) => request(`/webhooks/${id}/rotate`, { method: "POST" }),
  testWebhook: (id) => request(`/webhooks/${id}/test`, { method: "POST" }),
  webhookDeliveries: (id) => request(`/webhooks/${id}/deliveries`),
  redeliverWebhook: (deliveryId) => request(`/webhooks/deliveries/${deliveryId}/redeliver`, { method: "POST" }),

  // roles & permissions
  listRoles: () => request("/roles"),
  createRole: (payload) => request("/roles", { method: "POST", body: payload }),
  updateRole: (id, payload) => request(`/roles/${id}`, { method: "PUT", body: payload }),
  deleteRole: (id) => request(`/roles/${id}`, { method: "DELETE" }),

  // activity log (agency) + platform panel (super admin)
  listLogs: (query = "") => request(`/logs${query ? `?${query}` : ""}`),
  logFilters: () => request("/logs/filters"),
  platformAgencies: () => request("/platform/agencies"),
  platformCreateAgency: (payload) => request("/platform/agencies", { method: "POST", body: payload }),
  platformUpdateAgency: (id, payload) => request(`/platform/agencies/${id}`, { method: "PATCH", body: payload }),
  platformLogs: (query = "") => request(`/platform/logs${query ? `?${query}` : ""}`),
  platformLogFilters: () => request("/platform/logs/filters"),

  listClients: (query = "") => request(`/clients${query ? `?${query}` : ""}`),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (payload) => request("/clients", { method: "POST", body: payload }),
  updateClient: (id, payload) => request(`/clients/${id}`, { method: "PUT", body: payload }),
  deleteClient: (id) => request(`/clients/${id}`, { method: "DELETE" }),

  listServices: () => request("/services"),
  createService: (payload) => request("/services", { method: "POST", body: payload }),
  updateService: (id, payload) => request(`/services/${id}`, { method: "PUT", body: payload }),
  deleteService: (id) => request(`/services/${id}`, { method: "DELETE" }),
  getClientServices: (clientId) => request(`/services/client/${clientId}`),
  setClientServices: (clientId, serviceIds) => request(`/services/client/${clientId}`, { method: "PUT", body: { service_ids: serviceIds } }),

  listInvoices: (query = "") => request(`/invoices${query ? `?${query}` : ""}`),
  createInvoice: (payload) => request("/invoices", { method: "POST", body: payload }),
  updateInvoice: (id, payload) => request(`/invoices/${id}`, { method: "PUT", body: payload }),
  deleteInvoice: (id) => request(`/invoices/${id}`, { method: "DELETE" }),
  generateMonthlyInvoices: () => request("/invoices/generate-monthly", { method: "POST" }),

  async openInvoicePdf(id) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/invoices/${id}/pdf?lang=${getLang()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(t("تعذر توليد ملف PDF للفاتورة"));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  },

  async openInvoiceReceipt(id) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/invoices/${id}/receipt`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(t("تعذر تحميل إيصال الدفع"));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  },

  listExpenses: (query = "") => request(`/expenses${query ? `?${query}` : ""}`),
  createExpense: (payload) => request("/expenses", { method: "POST", body: payload }),
  updateExpense: (id, payload) => request(`/expenses/${id}`, { method: "PUT", body: payload }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),

  async openExpenseScreenshot(id) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/expenses/${id}/screenshot`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(t("تعذر تحميل صورة الإيصال"));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  },

  listCollection: (query = "") => request(`/collection${query ? `?${query}` : ""}`),
  getCollectionEntry: (id) => request(`/collection/${id}`),
  createCollectionEntry: (payload) => request("/collection", { method: "POST", body: payload }),
  updateCollectionEntry: (id, payload) => request(`/collection/${id}`, { method: "PUT", body: payload }),
  deleteCollectionEntry: (id) => request(`/collection/${id}`, { method: "DELETE" }),
  addFollowUp: (id, payload) => request(`/collection/${id}/follow-ups`, { method: "POST", body: payload }),
  quickAction: (id, action) => request(`/collection/${id}/quick-action`, { method: "POST", body: { action, lang: getLang() } }),
  partialPayment: (id, amount) => request(`/collection/${id}/partial-payment`, { method: "POST", body: { amount } }),
  collectionReport: (currency) => request(`/collection/report/summary?currency=${encodeURIComponent(currency)}`),

  listAdBudgets: (query = "") => request(`/ad-budgets${query ? `?${query}` : ""}`),
  createAdBudget: (payload) => request("/ad-budgets", { method: "POST", body: payload }),
  updateAdBudget: (id, payload) => request(`/ad-budgets/${id}`, { method: "PUT", body: payload }),
  deleteAdBudget: (id) => request(`/ad-budgets/${id}`, { method: "DELETE" }),
  adBudgetReport: (currency) => request(`/ad-budgets/report/summary?currency=${encodeURIComponent(currency)}`),

  financeSummary: (query = "") => request(`/finance/summary${query ? `?${query}` : ""}`),
  paymentCenter: (query = "") => request(`/finance/payment-center${query ? `?${query}` : ""}`),
  agingReport: (query = "") => request(`/finance/aging-report${query ? `?${query}` : ""}`),
  monthlyTrend: (query = "") => request(`/finance/monthly-trend${query ? `?${query}` : ""}`),
  financeByService: (query = "") => request(`/finance/by-service${query ? `?${query}` : ""}`),
  personalExpensesSummary: () => request(`/finance/personal-summary`),
  expenseCategoriesBreakdown: (query = "") => request(`/finance/expense-categories${query ? `?${query}` : ""}`),
  clientGrowth: () => request(`/finance/client-growth`),
  clientProfitability: (query = "") => request(`/finance/client-profitability${query ? `?${query}` : ""}`),
  clientHealth: (query = "") => request(`/finance/client-health${query ? `?${query}` : ""}`),
  renewalAnalytics: () => request(`/finance/renewal-analytics`),
  cashFlowForecast: () => request(`/finance/cash-flow-forecast`),
  alerts: () => request(`/finance/alerts`),
  recordInvoicePayment: (id, amount) => request(`/invoices/${id}/record-payment`, { method: "POST", body: { amount } }),
};
