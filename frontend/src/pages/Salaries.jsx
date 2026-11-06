import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { NAVY, NAVY_SOFT, GOLD, TEAL, RED, GREEN, inputStyle, btnStyle, formatMoney, toISODate, INK, PILL } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, StatCard } from "../components/Bits";
import { useAccount } from "../context/AccountContext";
import { t, MONTHS } from "../i18n";

const SALARY_CATEGORY = "رواتب";

const MONTHS_AR = MONTHS;
function monthLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`;
}
function firstOfMonth(iso) {
  const d = new Date(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

const emptySalary = () => ({
  name: "", amount: "", currency: "EGP", date: toISODate(new Date()), notes: "", screenshot_base64: null,
});

export default function Salaries() {
  const { can } = useAccount();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [monthFilter, setMonthFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listExpenses(`category=${encodeURIComponent(SALARY_CATEGORY)}`);
      setRows(data);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => firstOfMonth(r.date)));
    return Array.from(set).sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => {
    if (monthFilter === "all") return rows;
    return rows.filter((r) => firstOfMonth(r.date) === monthFilter);
  }, [rows, monthFilter]);

  const totalThisView = filtered.reduce((s, r) => s + Number(r.amount), 0);
  const employeeCount = new Set(filtered.map((r) => r.name)).size;

  const openNew = () => { setEditing(emptySalary()); setModalOpen(true); };
  const openEdit = (r) => { setEditing({ ...r, date: r.date?.slice(0, 10), screenshot_base64: null }); setModalOpen(true); };

  const save = async (form) => {
    const payload = { ...form, category: SALARY_CATEGORY, expense_type: "business" };
    if (form.id) await api.updateExpense(form.id, payload);
    else await api.createExpense(payload);
    setModalOpen(false); setEditing(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm(t("متأكد من حذف سجل الراتب ده؟"))) return;
    await api.deleteExpense(id);
    setModalOpen(false); setEditing(null);
    load();
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("رواتب الموظفين")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("سجل شهري لرواتب الفريق مع إيصال التحويل")}</div>
        </div>
        {can("expenses", "create") && <button onClick={openNew} style={btnStyle(GOLD)}>{t("+ راتب جديد")}</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatCard label={t("إجمالي المعروض")} value={formatMoney(totalThisView, "EGP")} color={RED} />
        <StatCard label={t("عدد الموظفين")} value={employeeCount} color={TEAL} />
        <StatCard label={t("عدد السجلات")} value={filtered.length} color={INK} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => setMonthFilter("all")} style={{ fontSize: 12.5, padding: "6px 14px", borderRadius: 20, border: `1px solid ${monthFilter === "all" ? PILL : "var(--border)"}`, background: monthFilter === "all" ? PILL : "var(--surface)", color: monthFilter === "all" ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>{t("كل الشهور")}</button>
        {months.map((m) => (
          <button key={m} onClick={() => setMonthFilter(m)} style={{ fontSize: 12.5, padding: "6px 14px", borderRadius: 20, border: `1px solid ${monthFilter === m ? PILL : "var(--border)"}`, background: monthFilter === m ? PILL : "var(--surface)", color: monthFilter === m ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>{monthLabel(m)}</button>
        ))}
      </div>

      {loading ? <EmptyBox>{t("جارٍ التحميل…")}</EmptyBox> : filtered.length === 0 ? <EmptyBox>{t("لا توجد رواتب مسجلة")}</EmptyBox> : (
        <div className="tat-card" style={{ overflow: "hidden" }}>
          {[...filtered].sort((a, b) => b.date.localeCompare(a.date)).map((r, i) => (
            <div key={r.id} onClick={can("expenses", "edit") ? () => openEdit(r) : undefined} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border-soft)", cursor: can("expenses", "edit") ? "pointer" : "default" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name || t("(بدون اسم)")}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{monthLabel(r.date)}{r.notes ? " · " + r.notes : ""}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: RED }}>{formatMoney(r.amount, r.currency)}</div>
              {r.has_screenshot && (
                <button
                  onClick={(e) => { e.stopPropagation(); api.openExpenseScreenshot(r.id).catch((err) => alert(err.message)); }}
                  style={{ fontSize: 11, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: TEAL, cursor: "pointer" }}
                >{t("📎 الإيصال")}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && editing && (
        <SalaryModal salary={editing} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={save} onDelete={editing.id && can("expenses", "delete") ? () => remove(editing.id) : null} />
      )}
    </div>
  );
}

function SalaryModal({ salary, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(salary);
  const [previewUrl, setPreviewUrl] = useState(null);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.name.trim().length > 0 && form.amount;

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      update("screenshot_base64", reader.result);
      setPreviewUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={salary.id ? t("تعديل راتب") : t("راتب جديد")}>
        <FieldLabel>{t("اسم الموظف")}</FieldLabel>
        <input value={form.name} onChange={(e) => update("name", e.target.value)} style={inputStyle} placeholder={t("مثال: أحمد محمد")} />

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("المبلغ (جنيه مصري)")}</FieldLabel><input type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><FieldLabel>{t("شهر الراتب")}</FieldLabel><input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} style={inputStyle} /></div>
        </div>

        <FieldLabel>{t("ملاحظات (اختياري)")}</FieldLabel>
        <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />

        <FieldLabel>{t("سكرين شوت تحويل الراتب")}</FieldLabel>
        <input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0])} style={{ ...inputStyle, padding: "6px" }} />
        {salary.id && salary.has_screenshot && !previewUrl && (
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 6 }}>{t("في إيصال متحفظ بالفعل — ارفع صورة جديدة بس لو عايز تستبدله.")}</div>
        )}
        {previewUrl && (
          <img src={previewUrl} alt={t("معاينة")} style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 6, border: "1px solid var(--border)", marginTop: 4, marginBottom: 8, display: "block" }} />
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!canSave} onClick={() => canSave && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: canSave ? 1 : 0.5 }}>{t("حفظ")}</button>
          {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
        </div>
      </ModalShell>
    </Overlay>
  );
}
