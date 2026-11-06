import React from "react";
import { Overlay } from "./Modal";
import Icon from "./Icons";
import { t } from "../i18n";

// Dashboard sections the user can show/hide ("Add widget"). The ids are
// whitelisted by the backend (lib/settingsValidation.js) — keep them in sync.
export const DASHBOARD_WIDGETS = [
  { id: "kpis", get title() { return t("المؤشرات الرئيسية"); }, get desc() { return t("الإيرادات والمحصّل وعمولة الإعلانات والمصاريف مع المقارنة بالفترة السابقة."); }, tag: "#الأداء", icon: "chart" },
  { id: "profit", get title() { return t("صافي الربح"); }, get desc() { return t("صافي الربح والهامش واتجاه الشهور الأخيرة، مع نمو الإيرادات والمدفوعات المتأخرة."); }, tag: "#الربحية", icon: "trend" },
  { id: "trend", get title() { return t("الاتجاه الشهري"); }, get desc() { return t("رسم الإيرادات والمحصّل والمصاريف لآخر 12 شهر."); }, tag: "#الاتجاهات", icon: "activity" },
  { id: "clients", get title() { return t("ملخص العملاء"); }, get desc() { return t("أعداد العملاء حسب الحالة والتجديدات القريبة."); }, tag: "#العملاء", icon: "users" },
  { id: "cash", get title() { return t("المستحق والنقدية"); }, get desc() { return t("المبلغ المستحق، والربح بعد المصاريف الشخصية، والنقدية المتاحة."); }, tag: "#السيولة", icon: "wallet" },
  { id: "distribution", get title() { return t("توزيع الإيرادات"); }, get desc() { return t("نسبة إيراد كل خدمة من الإجمالي في دونات نصف دائرية."); }, tag: "#الخدمات", icon: "pie" },
  { id: "growth", get title() { return t("نمو العملاء"); }, get desc() { return t("عدد العملاء الجدد شهريًا آخر 12 شهر."); }, tag: "#النمو", icon: "refresh" },
  { id: "byService", get title() { return t("الأداء حسب الخدمة"); }, get desc() { return t("جدول إيرادات وصافي ربح كل خدمة."); }, tag: "#الخدمات", icon: "table" },
];

export const ALL_WIDGET_IDS = DASHBOARD_WIDGETS.map((w) => w.id);

// Widgets that existed before "distribution" was added. An account that had ALL
// of them visible keeps seeing everything (including newer widgets) instead of
// silently missing the new one.
export const LEGACY_WIDGET_IDS = ["kpis", "profit", "trend", "clients", "cash", "byService", "growth"];

export function resolveEnabledWidgets(saved) {
  if (!Array.isArray(saved)) return ALL_WIDGET_IDS;
  if (LEGACY_WIDGET_IDS.every((id) => saved.includes(id))) return ALL_WIDGET_IDS;
  return saved;
}

export default function WidgetPicker({ enabled, onToggle, onReset, onClose }) {
  const on = new Set(enabled);
  return (
    <Overlay onClose={onClose}>
      <div className="tat-card tat-widget-picker" role="dialog" aria-label={t("إضافة ويدجت")}>
        <div className="tat-widget-head">
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{t("إضافة ويدجت")}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{t("اختار الأقسام اللي تظهر في لوحة القيادة — بتتحفظ على حسابك.")}</div>
          </div>
          <button type="button" className="tat-icon-btn solid" onClick={onClose} aria-label={t("إغلاق")}><Icon name="close" size={16} /></button>
        </div>

        <div className="tat-widget-list">
          {DASHBOARD_WIDGETS.map((w) => {
            const active = on.has(w.id);
            return (
              <div key={w.id} className={`tat-widget-row${active ? " on" : ""}`}>
                <span className="tat-widget-tile" aria-hidden="true"><Icon name={w.icon} size={22} /></span>
                <div className="tat-widget-info">
                  <div className="t">{w.title}</div>
                  <div className="d">{w.desc}</div>
                  <span className="tag">{w.tag}</span>
                </div>
                <button type="button" className={`tat-widget-btn${active ? " remove" : ""}`} onClick={() => onToggle(w.id)}>
                  <Icon name={active ? "minus" : "plus"} size={14} />{active ? t("إزالة") : t("إضافة")}
                </button>
              </div>
            );
          })}
        </div>

        <div className="tat-widget-foot">
          <button type="button" className="tat-pop-link" onClick={onReset}>{t("إظهار الكل")}</button>
          <button type="button" className="tat-pop-apply" onClick={onClose}>{t("تم")}</button>
        </div>
      </div>
    </Overlay>
  );
}
