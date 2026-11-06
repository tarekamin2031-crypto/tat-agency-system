import { t } from "../i18n";
// Display names for permission modules/actions and for audit-log events.
// Kept in one file so the Phase 2 translation (ar/en) only has to touch this.

export const MODULE_LABELS = {
  get dashboard() { return t("لوحة القيادة"); },
  get clients() { return t("العملاء"); },
  get invoices() { return t("الفواتير"); },
  get expenses() { return t("مصاريف الشركة"); },
  get personal_expenses() { return t("المصاريف الشخصية (CEO)"); },
  get collection() { return t("التحصيل والمدفوعات"); },
  get ad_budgets() { return t("إعلانات العملاء"); },
  get services() { return t("الخدمات"); },
  get reports() { return t("التقارير والتحليلات"); },
  get team() { return t("الفريق"); },
  get settings() { return t("إعدادات الشركة"); },
  get logs() { return t("سجل النشاط"); },
};

export const ACTION_LABELS = { get view() { return t("عرض"); }, get create() { return t("إضافة"); }, get edit() { return t("تعديل"); }, get delete() { return t("حذف"); }, get export() { return t("تصدير"); } };

const ENTITY_LABELS = {
  get client() { return t("عميل"); }, get invoice() { return t("فاتورة"); }, get expense() { return t("مصروف"); }, get collection() { return t("تحصيل"); }, get collection_entry() { return t("سجل تحصيل"); },
  get ad_budget() { return t("إعلان عميل"); }, get service() { return t("خدمة"); }, get settings() { return t("الإعدادات"); }, get company_settings() { return t("إعدادات الشركة"); },
  get webhook() { return t("Webhook"); }, get email_settings() { return t("إعدادات البريد"); }, get platform() { return t("المنصة"); },
  get auth() { return t("الحساب"); }, get user() { return t("مستخدم"); }, get role() { return t("دور"); }, get profile() { return t("الملف الشخصي"); }, get permission() { return t("الصلاحيات"); }, get agency() { return t("وكالة"); },
};

const VERB_LABELS = {
  get create() { return t("إضافة"); }, get update() { return t("تعديل"); }, get delete() { return t("حذف"); }, get login() { return t("تسجيل دخول"); }, get login_failed() { return t("محاولة دخول فاشلة"); },
  get logout() { return t("تسجيل خروج"); }, get logout_all() { return t("تسجيل خروج من كل الأجهزة"); }, get password_change() { return t("تغيير كلمة المرور"); },
  get password_reset() { return t("إعادة تعيين كلمة المرور"); }, get payment() { return t("تسجيل دفعة"); }, get pdf() { return t("فتح PDF"); }, get generate_monthly() { return t("توليد الفواتير الشهرية"); },
  get services_update() { return t("تعديل خدمات العميل"); }, get follow_up() { return t("إضافة متابعة"); }, get reminder() { return t("إرسال تذكير"); }, get contacted() { return t("تم التواصل"); },
  get confirm_payment() { return t("تأكيد الدفع"); }, get logo_update() { return t("تغيير الشعار"); }, get logo_delete() { return t("حذف الشعار"); }, get role_assigned() { return t("تغيير الدور"); },
  get email_update() { return t("تعديل إعدادات البريد"); }, get email_test() { return t("اختبار البريد"); }, get rotate() { return t("تجديد مفتاح Webhook"); }, get test() { return t("اختبار Webhook"); }, get password_reset_request() { return t("طلب إعادة تعيين كلمة المرور"); },
  get enable() { return t("تفعيل"); }, get disable() { return t("إيقاف"); },
};

// "invoice.create" -> { entity: "فاتورة", verb: "إضافة", get label() { return t("إضافة فاتورة"); } }
export function describeAction(action) {
  const [ent, ...rest] = String(action || "").split(".");
  const verbKey = rest.join(".");
  const entity = ENTITY_LABELS[ent] || ent;
  const verb = VERB_LABELS[verbKey] || verbKey;
  if (!verbKey) return { entity, verb: "", label: entity };
  // account-level events read better without the entity ("تسجيل دخول")
  const standalone = (["auth", "profile"].includes(ent) || ["email_update", "email_test", "rotate", "test"].includes(verbKey)) && VERB_LABELS[verbKey];
  return { entity, verb, label: standalone ? (ent === "profile" ? t("تعديل الملف الشخصي") : verb) : `${verb} ${entity}` };
}

// Color family of an event, for the little badge in the log table.
export function actionTone(action) {
  const a = String(action || "");
  if (/login_failed|\.delete$|disable/.test(a)) return "var(--red)";
  if (/\.create$|enable|login$/.test(a)) return "var(--green)";
  if (/permission|role|password|logout/.test(a)) return "var(--orange)";
  return "var(--teal)";
}
