import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { NAVY, GOLD, TEAL, RED, GREEN, inputStyle, btnStyle, darken, formatMoney, formatDateArabic, toISODate, INK, PILL, tint } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, FilterPills, StatCard } from "../components/Bits";
import { useAccount } from "../context/AccountContext";
import ExpensesTab from "./ExpensesTab";
import FinancialAnalyticsTab from "./FinancialAnalyticsTab";
import { t } from "../i18n";

const INVOICE_STATUSES = [
  { id: "draft", get label() { return t("مسودة"); }, color: "#9CA3AF" },
  { id: "sent", get label() { return t("مرسلة"); }, color: GOLD },
  { id: "paid", get label() { return t("مدفوعة"); }, color: GREEN },
  { id: "overdue", get label() { return t("متأخرة"); }, color: RED },
];
export const COMPANY_EXPENSE_CATEGORY_GROUPS = [
  { get label() { return t("ثابتة"); }, options: ["رواتب", "إيجار", "برمجيات", "استضافة", "إنترنت", "مرافق"] },
  { get label() { return t("متغيّرة"); }, options: ["فريلانسرز", "مصممين", "مونتاج فيديو", "صنّاع محتوى", "إنتاج", "تسويق", "إعلانات"] },
];
export const PERSONAL_EXPENSE_CATEGORIES = [
  "سكن", "سيارة", "بنزين", "أكل وشرب", "سفر", "تسوق", "تعليم", "صحة", "ترفيه", "أقساط", "فواتير شخصية", "تحويل شخصي", "أخرى",
];
export const CUSTOM_CATEGORY = "__custom__";

const emptyInvoice = (clients) => ({ client_id: clients[0]?.id || "", number: "", description: "", amount: "", currency: "EGP", issue_date: toISODate(new Date()), due_date: "", status: "draft", paid_amount: 0, service_id: "" });

export default function Invoices() {
  const { can } = useAccount();
  const canExpenses = can("expenses", "view") || can("personal_expenses", "view");
  const canAnalytics = can("reports", "view") || can("dashboard", "view");
  const filters = useFilters();
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [finance, setFinance] = useState(null);
  const [tab, setTab] = useState(can("invoices", "view") ? "invoices" : canExpenses ? "expenses" : "analytics");
  const currency = "EGP";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [invModalOpen, setInvModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const q = filters.toQueryString();
      // A role may lack the clients / services / finance views; the page still works without them.
      const soft = (p, fallback) => p.catch(() => fallback);
      const [c, s, i, fin] = await Promise.all([
        soft(api.listClients(q), []), soft(api.listServices(), []), soft(api.listInvoices(q), []), soft(api.financeSummary(q), null),
      ]);
      setClients(c); setServices(s); setInvoices(i); setFinance(fin);
    } catch (err) {
      setLoadError(err.message || t("تعذر تحميل بيانات الفواتير والمصاريف"));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((i) => statusFilter === "all" || i.status === statusFilter).sort((a, b) => b.issue_date.localeCompare(a.issue_date));
  }, [invoices, statusFilter]);

  const openNewInvoice = () => { setEditingInvoice(emptyInvoice(clients)); setInvModalOpen(true); };
  const openEditInvoice = (inv) => { setEditingInvoice({ ...inv, issue_date: inv.issue_date?.slice(0, 10), due_date: inv.due_date?.slice(0, 10) || "" }); setInvModalOpen(true); };
  const saveInvoice = async (form) => {
    if (form.id) await api.updateInvoice(form.id, form);
    else await api.createInvoice(form);
    setInvModalOpen(false); setEditingInvoice(null); load();
  };
  const deleteInvoiceEntry = async (id) => {
    if (!confirm(t("متأكد من حذف الفاتورة؟"))) return;
    await api.deleteInvoice(id);
    setInvModalOpen(false); setEditingInvoice(null); load();
  };
  const downloadPdf = async (id) => {
    try { await api.openInvoicePdf(id); } catch (err) { alert(err.message); }
  };
  const viewReceipt = async (id) => {
    try { await api.openInvoiceReceipt(id); } catch (err) { alert(err.message); }
  };
  const [generating, setGenerating] = useState(false);
  const runMonthlyGeneration = async () => {
    setGenerating(true);
    try {
      const res = await api.generateMonthlyInvoices();
      alert(t("تم إنشاء {created} فاتورة تلقائية لهذا الشهر", { created: res.created }));
      load();
    } catch (err) {
      alert(t("تعذر تشغيل الفوترة التلقائية: ") + err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("الفواتير والمصاريف")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("متابعة الإيرادات والمصاريف (جنيه مصري)")}</div>
        </div>
      </div>

      {loadError && (
        <div style={{ background: "var(--red-bg)", border: `1px solid ${tint(RED, 33)}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 12.5, color: RED }}>
          ⚠ {t("تعذر تحميل البيانات:")} {loadError}
          <br />
          <span style={{ fontSize: 11.5 }}>{t("راجع الـ backend logs — غالبًا آخر تحديث للسيرفر لسه ما اتطبّقش صح.")}</span>
          <button onClick={load} style={{ ...btnStyle(RED), marginTop: 8, fontSize: 12 }}>{t("إعادة المحاولة")}</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatCard label={t("الإيرادات (قيمة الفواتير)")} value={formatMoney(finance?.revenue, currency)} color={INK} />
        <StatCard label={t("المحصّل فعليًا (Cash)")} value={formatMoney(finance?.cashCollected, currency)} color={GREEN} />
        <StatCard label={t("عمولة الإعلانات")} value={formatMoney(finance?.adCommission, currency)} color={TEAL} />
        <StatCard label={t("الرصيد المستحق")} value={formatMoney(finance?.outstandingBalance, currency)} color={GOLD} />
        <StatCard label={t("مصاريف الشركة")} value={formatMoney(finance?.totalExpenses, currency)} color={RED} />
        <StatCard label={t("صافي ربح الشركة")} value={formatMoney(finance?.netProfit, currency)} color={(finance?.netProfit ?? 0) >= 0 ? GREEN : RED} />
        <StatCard label={t("مصاريف CEO الشخصية")} value={formatMoney(finance?.personalExpenses, currency)} color={"var(--ink-3)"} />
        <StatCard label={t("الربح بعد المصاريف الشخصية")} value={formatMoney(finance?.profitAfterPersonal, currency)} color={(finance?.profitAfterPersonal ?? 0) >= 0 ? GREEN : RED} />
        <StatCard label={t("رصيد النقدية المتاح")} value={formatMoney(finance?.cashAvailable, currency)} color={TEAL} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {can("invoices", "view") && <TabBtn active={tab === "invoices"} onClick={() => setTab("invoices")}>{t("الفواتير")}</TabBtn>}
        {canExpenses && <TabBtn active={tab === "expenses"} onClick={() => setTab("expenses")}>{t("المصاريف")}</TabBtn>}
        {canAnalytics && <TabBtn active={tab === "analytics"} onClick={() => setTab("analytics")}>{t("التحليل المالي")}</TabBtn>}
      </div>

      {tab === "analytics" ? (
        <FinancialAnalyticsTab />
      ) : tab === "expenses" ? (
        <ExpensesTab clients={clients} services={services} onDataChanged={load} />
      ) : loading ? <EmptyBox>{t("جارٍ التحميل…")}</EmptyBox> : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <FilterPills options={[{ id: "all", get label() { return t("الكل"); } }, ...INVOICE_STATUSES]} value={statusFilter} onChange={setStatusFilter} />
            <div style={{ display: "flex", gap: 8 }}>
              {can("invoices", "create") && (
                <button onClick={runMonthlyGeneration} disabled={generating} style={{ ...btnStyle(TEAL), opacity: generating ? 0.6 : 1 }}>
                  {generating ? t("جارٍ التوليد…") : t("توليد فواتير هذا الشهر")}
                </button>
              )}
              {can("invoices", "create") && <button onClick={openNewInvoice} style={btnStyle(GOLD)}>{t("+ فاتورة جديدة")}</button>}
            </div>
          </div>
          {filteredInvoices.length === 0 ? <EmptyBox>{t("لا توجد فواتير")}</EmptyBox> : (
            <div className="tat-card" style={{ overflow: "hidden" }}>
              {filteredInvoices.map((inv, i) => {
                const st = INVOICE_STATUSES.find((s) => s.id === inv.status);
                return (
                  <div key={inv.id} onClick={can("invoices", "edit") ? () => openEditInvoice(inv) : undefined} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border-soft)", cursor: "pointer" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: st?.color || "#999" }} />
                    <div style={{ width: 90, fontSize: 12, color: "var(--ink-3)" }}>{inv.number}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {inv.client_name || t("بدون عميل")}
                        {inv.is_auto_generated && <span style={{ fontSize: 10.5, color: TEAL, marginRight: 6 }}>{t("· تلقائية")}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{formatDateArabic(inv.issue_date)}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{formatMoney(inv.amount, inv.currency)}</div>
                    <span style={{ fontSize: 11.5, padding: "3px 10px", borderRadius: 20, background: tint((st?.color || "#999"), 13), color: darken(st?.color || "#999") }}>{st?.label}</span>
                    {inv.has_receipt && (
                      <button onClick={(e) => { e.stopPropagation(); viewReceipt(inv.id); }} style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: TEAL, cursor: "pointer" }}>{t("📎 الإيصال")}</button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); downloadPdf(inv.id); }} style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: INK, cursor: "pointer" }}>PDF</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {invModalOpen && editingInvoice && (
        <InvoiceModal invoice={editingInvoice} clients={clients} services={services} onClose={() => { setInvModalOpen(false); setEditingInvoice(null); }} onSave={saveInvoice} onDelete={editingInvoice.id && can("invoices", "delete") ? () => deleteInvoiceEntry(editingInvoice.id) : null} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return <button type="button" className={`tat-tab${active ? " on" : ""}`} onClick={onClick}>{children}</button>;
}

function InvoiceModal({ invoice, clients, services, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(invoice);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewMime, setPreviewMime] = useState(null);
  // Status and "collected amount" must always agree — Payment Center and
  // Collection Center read the collected amount, so marking an invoice paid
  // has to fill it in (and typing a full payment has to mark it paid).
  const update = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    const total = Number(next.amount) || 0;
    const paid = Number(next.paid_amount) || 0;
    if (k === "status" && v === "paid") next.paid_amount = total;
    if (k === "status" && v !== "paid" && paid >= total && total > 0) next.paid_amount = 0;
    if (k === "amount" && next.status === "paid") next.paid_amount = total;
    if (k === "paid_amount") {
      if (total > 0 && paid >= total) next.status = "paid";
      else if (next.status === "paid") next.status = paid > 0 ? "sent" : "sent";
    }
    return next;
  });
  const canSave = form.amount;

  const handleReceiptFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      update("receipt_base64", reader.result);
      update("receipt_filename", file.name);
      setPreviewUrl(reader.result);
      setPreviewMime(file.type);
    };
    reader.readAsDataURL(file);
  };

  // When a client is picked (or changed) on a NEW invoice with no service
  // chosen yet, auto-suggest that client's first assigned service — saves
  // a step for the common case, but never overrides a manual choice.
  useEffect(() => {
    if (!form.client_id || form.service_id) return;
    let cancelled = false;
    api.getClientServices(form.client_id).then((assigned) => {
      if (!cancelled && assigned.length > 0) update("service_id", assigned[0].id);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id]);

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={invoice.id ? t("تعديل فاتورة") : t("فاتورة جديدة")}>
        <FieldLabel>{t("رقم الفاتورة")}</FieldLabel>
        <input value={form.number} onChange={(e) => update("number", e.target.value)} style={inputStyle} />
        <FieldLabel>{t("العميل")}</FieldLabel>
        <select value={form.client_id || ""} onChange={(e) => update("client_id", e.target.value)} style={inputStyle}>
          <option value="">{t("بدون عميل")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <FieldLabel>{t("الخدمة")}</FieldLabel>
        <select value={form.service_id || ""} onChange={(e) => update("service_id", e.target.value)} style={inputStyle}>
          <option value="">{t("بدون خدمة محددة")}</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <FieldLabel>{t("وصف الخدمة")}</FieldLabel>
        <input value={form.description} onChange={(e) => update("description", e.target.value)} style={inputStyle} />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("المبلغ (جنيه مصري)")}</FieldLabel><input type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><FieldLabel>{t("المحصّل فعليًا (جنيه)")}</FieldLabel><input type="number" value={form.paid_amount ?? 0} onChange={(e) => update("paid_amount", e.target.value)} style={inputStyle} /></div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("تاريخ الإصدار")}</FieldLabel><input type="date" value={form.issue_date} onChange={(e) => update("issue_date", e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><FieldLabel>{t("تاريخ الاستحقاق")}</FieldLabel><input type="date" value={form.due_date} onChange={(e) => update("due_date", e.target.value)} style={inputStyle} /></div>
        </div>
        <FieldLabel>{t("الحالة")}</FieldLabel>
        <select value={form.status} onChange={(e) => update("status", e.target.value)} style={inputStyle}>
          {INVOICE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        <FieldLabel>{t("إيصال الدفع (صورة أو PDF)")}</FieldLabel>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => handleReceiptFile(e.target.files?.[0])} style={{ ...inputStyle, padding: "6px" }} />
        {invoice.id && invoice.has_receipt && !previewUrl && (
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 6 }}>{t("في إيصال متحفظ بالفعل — ارفع ملف جديد بس لو عايز تستبدله.")}</div>
        )}
        {previewUrl && previewMime?.startsWith("image/") && (
          <img src={previewUrl} alt={t("معاينة")} style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 6, border: "1px solid var(--border)", marginTop: 4, marginBottom: 8, display: "block" }} />
        )}
        {previewUrl && previewMime === "application/pdf" && (
          <div style={{ fontSize: 12.5, color: TEAL, marginTop: 4, marginBottom: 8 }}>📄 {form.receipt_filename}{" "}{t("— جاهز للرفع")}</div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!canSave} onClick={() => canSave && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: canSave ? 1 : 0.5 }}>{t("حفظ")}</button>
          {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
        </div>
      </ModalShell>
    </Overlay>
  );
}

export function ExpenseModal({ expense, clients, services, lockedType, onClose, onSave, onDelete }) {
  const effectiveType = lockedType || expense.expense_type || "business";
  const categoryOptionsFlat = effectiveType === "personal"
    ? PERSONAL_EXPENSE_CATEGORIES
    : COMPANY_EXPENSE_CATEGORY_GROUPS.flatMap((g) => g.options);
  const isKnownCategory = categoryOptionsFlat.includes(expense.category);
  const [form, setForm] = useState({ ...expense, expense_type: effectiveType });
  const [useCustomCategory, setUseCustomCategory] = useState(expense.category && !isKnownCategory);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.amount && form.category;

  const handleCategorySelect = (value) => {
    if (value === CUSTOM_CATEGORY) {
      setUseCustomCategory(true);
      update("category", "");
    } else {
      setUseCustomCategory(false);
      update("category", value);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={expense.id ? "تعديل مصروف" : (effectiveType === "personal" ? t("مصروف شخصي جديد") : t("مصروف شركة جديد"))}>
        <FieldLabel>{t("اسم المصروف / الوصف")}</FieldLabel>
        <input value={form.name} onChange={(e) => update("name", e.target.value)} style={inputStyle} placeholder={effectiveType === "personal" ? t("مثال: إيجار سبتمبر") : t("مثال: راتب مصمم جرافيك - سبتمبر")} />

        {!lockedType && (
          <>
            <FieldLabel>{t("نوع المصروف")}</FieldLabel>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => { update("expense_type", "business"); setUseCustomCategory(false); update("category", COMPANY_EXPENSE_CATEGORY_GROUPS[0].options[0]); }}
                style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: `1px solid ${form.expense_type !== "personal" ? PILL : "var(--border)"}`, background: form.expense_type !== "personal" ? PILL : "var(--surface)", color: form.expense_type !== "personal" ? "#fff" : "var(--ink-2)", fontSize: 13, cursor: "pointer" }}
              >{t("مصروف شركة")}</button>
              <button
                type="button"
                onClick={() => { update("expense_type", "personal"); setUseCustomCategory(false); update("category", PERSONAL_EXPENSE_CATEGORIES[0]); }}
                style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: `1px solid ${form.expense_type === "personal" ? GOLD : "var(--border)"}`, background: form.expense_type === "personal" ? GOLD : "var(--surface)", color: form.expense_type === "personal" ? "#fff" : "var(--ink-2)", fontSize: 13, cursor: "pointer" }}
              >{t("مصروف شخصي (CEO)")}</button>
            </div>
            {form.expense_type === "personal" && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 8 }}>{t("المصاريف الشخصية بتتابع هنا بس مش بتدخل في حساب صافي ربح الشركة.")}</div>
            )}
          </>
        )}

        <FieldLabel>{t("الفئة")}</FieldLabel>
        {!useCustomCategory ? (
          form.expense_type === "personal" ? (
            <select value={form.category} onChange={(e) => handleCategorySelect(e.target.value)} style={inputStyle}>
              {PERSONAL_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value={CUSTOM_CATEGORY}>{t("+ فئة مخصصة...")}</option>
            </select>
          ) : (
            <select value={form.category} onChange={(e) => handleCategorySelect(e.target.value)} style={inputStyle}>
              {COMPANY_EXPENSE_CATEGORY_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              ))}
              <option value={CUSTOM_CATEGORY}>{t("+ فئة مخصصة...")}</option>
            </select>
          )
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.category} onChange={(e) => update("category", e.target.value)} style={inputStyle} placeholder={t("اكتب اسم الفئة الجديدة")} autoFocus />
            <button onClick={() => setUseCustomCategory(false)} style={{ ...btnStyle(TEAL), flexShrink: 0 }}>{t("القائمة")}</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("المبلغ (جنيه مصري)")}</FieldLabel><input type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><FieldLabel>{t("التاريخ")}</FieldLabel><input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} style={inputStyle} /></div>
        </div>

        {form.expense_type === "personal" ? (
          <>
            <FieldLabel>{t("طريقة الدفع (اختياري)")}</FieldLabel>
            <input value={form.payment_method || ""} onChange={(e) => update("payment_method", e.target.value)} style={inputStyle} placeholder={t("كاش، تحويل بنكي، بطاقة...")} />
          </>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>{t("العميل المرتبط (اختياري)")}</FieldLabel>
              <select value={form.related_client_id || ""} onChange={(e) => update("related_client_id", e.target.value)} style={inputStyle}>
                <option value="">{t("بدون عميل")}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel>{t("الخدمة المرتبطة (اختياري)")}</FieldLabel>
              <select value={form.related_service_id || ""} onChange={(e) => update("related_service_id", e.target.value)} style={inputStyle}>
                <option value="">{t("بدون خدمة")}</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        )}

        <FieldLabel>{t("ملاحظات (اختياري)")}</FieldLabel>
        <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!canSave} onClick={() => canSave && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: canSave ? 1 : 0.5 }}>{t("حفظ")}</button>
          {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
        </div>
      </ModalShell>
    </Overlay>
  );
}
