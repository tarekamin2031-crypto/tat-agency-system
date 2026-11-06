import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { NAVY, GOLD, TEAL, RED, btnStyle, darken, formatMoney, formatDateArabic, toISODate, INK, tint } from "../theme";
import { EmptyBox, LoadingBox, StatCard, Badge } from "../components/Bits";
import Icon from "../components/Icons";
import { ExpenseModal } from "./Invoices";
import { useAccount } from "../context/AccountContext";
import { t, MONTHS } from "../i18n";

// Company and CEO-personal expenses are separate permission modules.
const modOf = (type) => (type === "personal" ? "personal_expenses" : "expenses");

const MONTHS_AR = MONTHS;

const TYPE_META = {
  business: { get label() { return t("شركة"); }, color: TEAL },
  personal: { get label() { return t("CEO شخصي"); }, color: GOLD },
};

const emptyExpense = () => ({
  name: "", category: "رواتب", amount: "", currency: "EGP", date: toISODate(new Date()),
  related_client_id: "", related_service_id: "", notes: "", payment_method: "", expense_type: "business",
});

const DEFAULT_FILTERS = { search: "", type: "all", month: "all", year: "all", category: "all", min: "", max: "" };

// One list + one filter bar for BOTH company expenses and the CEO's personal
// expenses. Personal ones are tagged and are still excluded from company net
// profit by the backend — only the viewing/filtering is unified here.
export default function ExpensesTab({ clients, services, onDataChanged }) {
  const { can } = useAccount();
  const canCreate = can("expenses", "create") || can("personal_expenses", "create");
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState(DEFAULT_FILTERS);
  const [modal, setModal] = useState(null); // null | expense object being created/edited
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setExpenses(await api.listExpenses());
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => Array.from(new Set(expenses.map((e) => e.date.slice(0, 4)))).sort().reverse(), [expenses]);
  const categories = useMemo(() => {
    const pool = f.type === "all" ? expenses : expenses.filter((e) => e.expense_type === f.type);
    return Array.from(new Set(pool.map((e) => e.category))).sort();
  }, [expenses, f.type]);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (f.type !== "all" && e.expense_type !== f.type) return false;
      if (q && !`${e.name || ""} ${e.description || ""} ${e.category || ""} ${e.notes || ""}`.toLowerCase().includes(q)) return false;
      if (f.month !== "all" && e.date.slice(5, 7) !== f.month) return false;
      if (f.year !== "all" && e.date.slice(0, 4) !== f.year) return false;
      if (f.category !== "all" && e.category !== f.category) return false;
      if (f.min && Number(e.amount) < Number(f.min)) return false;
      if (f.max && Number(e.amount) > Number(f.max)) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, f]);

  const sum = (list) => list.reduce((s, e) => s + Number(e.amount), 0);
  const companyTotal = sum(filtered.filter((e) => e.expense_type !== "personal"));
  const personalTotal = sum(filtered.filter((e) => e.expense_type === "personal"));

  const isDirty = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS);

  const save = async (form) => {
    try {
      if (form.id) await api.updateExpense(form.id, form);
      else await api.createExpense(form);
      setModal(null);
      notifySuccess(t("تم حفظ المصروف"));
      await load();
      onDataChanged?.();
    } catch (err) {
      notifyError(err);
    }
  };
  const remove = async (id) => {
    if (!confirm(t("متأكد من حذف المصروف؟"))) return;
    try {
      await api.deleteExpense(id);
      setModal(null);
      await load();
      onDataChanged?.();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <div>
      <div className="tat-expbar">
        <div className="tat-sbox tat-expbar-search">
          <span className="tat-sbox-icon"><Icon name="search" size={17} /></span>
          <input className="tat-sbox-input" value={f.search} onChange={(e) => set("search", e.target.value)} placeholder={t("ابحث باسم المصروف أو الفئة…")} />
          {f.search && <button className="tat-sbox-clear" onClick={() => set("search", "")} aria-label={t("مسح")}>×</button>}
        </div>

        <div className="tat-seg compact tat-expbar-type" role="radiogroup" aria-label={t("نوع المصروف")}>
          {[["all", t("الكل")], ["business", t("الشركة")], ["personal", "CEO"]].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={f.type === id} className={f.type === id ? "on" : ""} onClick={() => { set("type", id); set("category", "all"); }}>{label}</button>
          ))}
        </div>

        <span className="tat-bar-sep" aria-hidden="true" />

        <select className={`tat-ctl tat-select${f.month !== "all" ? " on" : ""}`} value={f.month} onChange={(e) => set("month", e.target.value)} aria-label={t("الشهر")}>
          <option value="all">{t("كل الشهور")}</option>
          {MONTHS_AR.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
        </select>
        <select className={`tat-ctl tat-select${f.year !== "all" ? " on" : ""}`} value={f.year} onChange={(e) => set("year", e.target.value)} aria-label={t("السنة")}>
          <option value="all">{t("كل السنين")}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className={`tat-ctl tat-select${f.category !== "all" ? " on" : ""}`} value={f.category} onChange={(e) => set("category", e.target.value)} aria-label={t("الفئة")}>
          <option value="all">{t("كل الفئات")}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className={`tat-range${f.min || f.max ? " on" : ""}`} aria-label={t("نطاق المبلغ")}>
          <Icon name="banknote" size={15} />
          <input type="number" value={f.min} onChange={(e) => set("min", e.target.value)} placeholder={t("من")} aria-label={t("أقل مبلغ")} />
          <span className="dash">–</span>
          <input type="number" value={f.max} onChange={(e) => set("max", e.target.value)} placeholder={t("إلى")} aria-label={t("أعلى مبلغ")} />
        </div>

        {isDirty && (
          <button className="tat-bar-reset icon" style={{ height: 42, width: 42 }} onClick={() => setF(DEFAULT_FILTERS)} title={t("إعادة تعيين الفلاتر")} aria-label={t("إعادة تعيين الفلاتر")}>
            <Icon name="reset" size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard icon="receipt" label={t("إجمالي المعروض")} value={formatMoney(companyTotal + personalTotal, "EGP")} color={INK} />
        <StatCard icon="banknote" label={t("مصاريف الشركة")} value={formatMoney(companyTotal, "EGP")} color={TEAL} />
        <StatCard icon="wallet" label={t("مصاريف CEO الشخصية")} value={formatMoney(personalTotal, "EGP")} color={GOLD} />
        <StatCard icon="chart" label={t("عدد السجلات")} value={filtered.length} color={"var(--ink-3)"} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("مصاريف CEO الشخصية بتتعرض هنا للمتابعة بس — مش بتدخل في صافي ربح الشركة.")}</div>
        {canCreate && <button type="button" className="tat-btn-primary" onClick={() => setModal(emptyExpense())}><Icon name="plus" size={16} /><span>{t("مصروف جديد")}</span></button>}
      </div>

      {loading ? <LoadingBox rows={3} /> : filtered.length === 0 ? <EmptyBox>{t("لا توجد مصاريف مطابقة")}</EmptyBox> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((exp) => {
            const meta = TYPE_META[exp.expense_type === "personal" ? "personal" : "business"];
            return (
              <div key={exp.id} className="tat-row" onClick={can(modOf(exp.expense_type), "edit") ? () => setModal({ ...exp, date: exp.date?.slice(0, 10) }) : undefined} style={{ cursor: can(modOf(exp.expense_type), "edit") ? "pointer" : "default" }}>
                <span className="tat-ico" style={{ "--c": meta.color }}><Icon name={exp.expense_type === "personal" ? "wallet" : "receipt"} size={19} /></span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{exp.name || exp.description || t("(بدون اسم)")}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                    {formatDateArabic(exp.date)}{exp.payment_method ? ` · ${exp.payment_method}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-2)", background: "var(--surface-2)", borderRadius: 9999, padding: "3px 11px" }}>{exp.category}</span>
                <Badge color={meta.color}>{meta.label}</Badge>
                <div className="tat-num" style={{ fontSize: 15, fontWeight: 700, color: RED, minWidth: 110, textAlign: "end" }}>−{formatMoney(exp.amount, exp.currency)}</div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <ExpenseModal
          expense={modal}
          clients={clients}
          services={services}
          lockedType={modal.id ? (modal.expense_type === "personal" ? "personal" : "business") : undefined}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.id && can(modOf(modal.expense_type), "delete") ? () => remove(modal.id) : null}
        />
      )}
    </div>
  );
}
