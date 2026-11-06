import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { NAVY, NAVY_SOFT, GOLD, TEAL, RED, ORANGE, GREEN, inputStyle, btnStyle, darken, formatMoney, formatDateArabic, toISODate, INK, PILL, tint } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, FilterPills, StatCard, InfoBlock } from "../components/Bits";
import PaymentPanels from "../components/PaymentPanels";
import { useAccount } from "../context/AccountContext";
import { t } from "../i18n";

const COMM_METHODS = [{ id: "whatsapp", get label() { return t("واتساب"); } }, { id: "phone", get label() { return t("مكالمة هاتفية"); } }, { id: "email", get label() { return t("بريد إلكتروني"); } }, { id: "meeting", get label() { return t("اجتماع"); } }, { id: "other", get label() { return t("أخرى"); } }];
const FOLLOWUP_STATUSES = [
  { id: "not_contacted", get label() { return t("لم يتم التواصل"); }, color: "#9CA3AF" },
  { id: "needs_followup", get label() { return t("تحتاج متابعة"); }, color: ORANGE },
  { id: "will_pay_soon", get label() { return t("العميل سيدفع قريباً"); }, color: TEAL },
  { id: "waiting_payment", get label() { return t("بانتظار الدفع"); }, color: GOLD },
  { id: "payment_confirmed", get label() { return t("تم تأكيد الدفع"); }, color: GREEN },
  { id: "no_response", get label() { return t("لا يوجد رد"); }, color: RED },
];

function isPaid(e) { return Number(e.amount_paid) >= Number(e.expected_amount) && Number(e.expected_amount) > 0; }
function paymentStatus(e, today) {
  if (isPaid(e)) return "paid";
  if (Number(e.amount_paid) > 0) return "partial";
  if (e.due_date && e.due_date.slice(0, 10) < today) return "overdue";
  return "pending";
}
const STATUS_META = {
  paid: { get label() { return t("مدفوع"); }, emoji: "🟢", color: GREEN },
  pending: { get label() { return t("معلّق"); }, emoji: "🟡", color: GOLD },
  partial: { get label() { return t("مدفوع جزئياً"); }, emoji: "🟠", color: ORANGE },
  overdue: { get label() { return t("متأخر"); }, emoji: "🔴", color: RED },
};
function daysOverdue(e, today) {
  if (!e.due_date || isPaid(e)) return 0;
  const d = Math.round((new Date(today) - new Date(e.due_date.slice(0, 10))) / 86400000);
  return d > 0 ? d : 0;
}
function priorityInfo(e, today) {
  if (isPaid(e)) return { id: "none", label: "—", color: null };
  const overdue = daysOverdue(e, today);
  const remaining = Number(e.expected_amount) - Number(e.amount_paid);
  const daysUntilDue = e.due_date ? Math.round((new Date(e.due_date.slice(0, 10)) - new Date(today)) / 86400000) : null;
  if (overdue > 7 || remaining >= 20000) return { id: "high", get label() { return t("أولوية عالية"); }, color: RED };
  if (overdue > 0 || (daysUntilDue !== null && daysUntilDue <= 3)) return { id: "medium", get label() { return t("أولوية متوسطة"); }, color: ORANGE };
  return { id: "low", get label() { return t("أولوية منخفضة"); }, color: GOLD };
}

const emptyEntry = (clients) => ({
  client_id: clients[0]?.id || "", invoice_id: "", company_name: "", service: "", expected_amount: "", amount_paid: "",
  currency: "EGP", due_date: toISODate(new Date()), account_manager_id: "", follow_up_status: "not_contacted",
  next_follow_up_date: "", last_communication_notes: "",
});

export default function Collection() {
  const { can } = useAccount();
  const canEdit = can("collection", "edit");
  const filters = useFilters();
  const [entries, setEntries] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const currency = "EGP";
  const [report, setReport] = useState(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [followUpTargetId, setFollowUpTargetId] = useState(null);
  const [partialTargetId, setPartialTargetId] = useState(null);

  const today = toISODate(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filters.toQueryString();
      const [e, c] = await Promise.all([api.listCollection(q), api.listClients(q)]);
      setEntries(e); setClients(c);
      try { setUsers(await api.listUsers()); } catch { setUsers([]); }
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const loadReport = useCallback(async () => {
    const data = await api.collectionReport(currency);
    setReport(data);
  }, [currency]);

  useEffect(() => { if (view === "report") loadReport(); }, [view, loadReport]);

  const todayTasks = useMemo(() => {
    return entries.filter((e) => !isPaid(e) && e.next_follow_up_date && e.next_follow_up_date.slice(0, 10) <= today);
  }, [entries, today]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const status = paymentStatus(e, today);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        if (!(e.client_name || "").toLowerCase().includes(s) && !(e.company_name || "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [entries, statusFilter, search, today]);

  const openNew = () => { setEditingEntry(emptyEntry(clients)); setModalOpen(true); };
  const openEdit = (e) => { setEditingEntry({ ...e, due_date: e.due_date?.slice(0, 10) || "", next_follow_up_date: e.next_follow_up_date?.slice(0, 10) || "" }); setModalOpen(true); };

  const save = async (form) => {
    if (form.id) await api.updateCollectionEntry(form.id, form);
    else await api.createCollectionEntry(form);
    setModalOpen(false); setEditingEntry(null); load();
  };
  const remove = async (id) => {
    if (!confirm(t("متأكد من حذف هذا السجل؟"))) return;
    await api.deleteCollectionEntry(id);
    setModalOpen(false); setEditingEntry(null); setDetailId(null); load();
  };

  const openDetail = async (id) => {
    setDetailId(id);
    const data = await api.getCollectionEntry(id);
    setDetailData(data);
  };
  const closeDetail = () => { setDetailId(null); setDetailData(null); };

  const doQuickAction = async (id, action) => {
    try {
      await api.quickAction(id, action);
      if (action === "email_reminder") notifySuccess(t("اتبعت التذكير بالإيميل"));
    } catch (err) {
      notifyError(err);
      return;
    }
    if (detailId === id) openDetail(id);
    load();
  };

  const doFollowUp = async (id, payload) => {
    await api.addFollowUp(id, payload);
    setFollowUpTargetId(null);
    if (detailId === id) openDetail(id);
    load();
  };

  const doPartialPayment = async (id, amount) => {
    await api.partialPayment(id, amount);
    setPartialTargetId(null);
    if (detailId === id) openDetail(id);
    load();
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("التحصيل والمدفوعات")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("حالة دفع كل فاتورة + متابعة العملاء المتأخرين في مكان واحد")}</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {can("collection", "create") && <button onClick={openNew} style={btnStyle(GOLD)}>{t("+ سجل تحصيل جديد")}</button>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <TabBtn active={view === "dashboard"} onClick={() => setView("dashboard")}>{t("لوحة التحصيل")}</TabBtn>
        <TabBtn active={view === "table"} onClick={() => setView("table")}>{t("جدول التحصيل")}</TabBtn>
        <TabBtn active={view === "invoices"} onClick={() => setView("invoices")}>{t("حالة الفواتير")}</TabBtn>
        <TabBtn active={view === "aging"} onClick={() => setView("aging")}>{t("أعمار الديون")}</TabBtn>
        <TabBtn active={view === "report"} onClick={() => setView("report")}>{t("تقرير الأداء")}</TabBtn>
      </div>

      {loading ? <EmptyBox>{t("جارٍ التحميل…")}</EmptyBox> : (
        <>
          {view === "dashboard" && (
            <div>
              <div className="tat-card" style={{ overflow: "hidden" }}>
                <div style={{ background: "var(--surface-2)", color: "var(--ink-2)", padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>{t("مهام التحصيل اليوم")}</div>
                {todayTasks.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)" }}>{t("لا توجد مهام متابعة مستحقة اليوم")}</div>
                ) : todayTasks.map((e, i) => {
                  const p = priorityInfo(e, today);
                  const remaining = Number(e.expected_amount) - Number(e.amount_paid);
                  return (
                    <div key={e.id} onClick={() => openDetail(e.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border-soft)", cursor: "pointer" }}>
                      {p.color && <span className="tat-dot" style={{ background: p.color }} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{e.client_name || e.company_name}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("المسؤول:")}{" "}{e.account_manager_name || "—"}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: RED }}>{formatMoney(remaining, e.currency)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(view === "invoices" || view === "aging") && <PaymentPanels section={view} onChanged={load} />}

          {view === "table" && (
            <div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ابحث...")} style={{ ...inputStyle, width: 200, marginBottom: 0 }} />
                <FilterPills options={[{ id: "all", get label() { return t("الكل"); } }, ...Object.entries(STATUS_META).map(([id, v]) => ({ id, label: v.label, color: v.color }))]} value={statusFilter} onChange={setStatusFilter} />
              </div>
              {filtered.length === 0 ? <EmptyBox>{t("لا توجد سجلات")}</EmptyBox> : (
                <div className="tat-card" style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-2)", color: "var(--ink-2)", fontSize: 12 }}>
                        <Th>{t("العميل")}</Th><Th>{t("المتوقع")}</Th><Th>{t("المدفوع")}</Th><Th>{t("المتبقي")}</Th><Th>{t("الاستحقاق")}</Th><Th>{t("التأخير")}</Th><Th>{t("الحالة")}</Th><Th>{t("الأولوية")}</Th><Th>{t("المسؤول")}</Th><Th>{t("إجراءات")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((e) => {
                        const status = paymentStatus(e, today);
                        const meta = STATUS_META[status];
                        const p = priorityInfo(e, today);
                        const remaining = Number(e.expected_amount) - Number(e.amount_paid);
                        const overdue = daysOverdue(e, today);
                        return (
                          <tr key={e.id} style={{ borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
                            <Td onClick={() => openDetail(e.id)} style={{ cursor: "pointer", fontWeight: 600 }}>
                              {e.client_name || e.company_name}
                              {e.invoice_id && <span title={t("مرتبط بفاتورة")} className="tat-dot" style={{ background: "var(--green)", marginInlineStart: 6 }} />}
                            </Td>
                            <Td>{formatMoney(e.expected_amount, e.currency)}</Td>
                            <Td>{formatMoney(e.amount_paid, e.currency)}</Td>
                            <Td style={{ fontWeight: 700, color: remaining > 0 ? RED : GREEN }}>{formatMoney(remaining, e.currency)}</Td>
                            <Td>{formatDateArabic(e.due_date)}</Td>
                            <Td style={{ color: overdue > 0 ? RED : "var(--ink-3)" }}>{overdue > 0 ? t("{overdue} يوم", { overdue: overdue }) : "—"}</Td>
                            <Td><span style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 14, background: tint(meta.color, 13), color: darken(meta.color) }}><span className="tat-dot" style={{ background: meta.color }} />{meta.label}</span></Td>
                            <Td>{p.color ? <><span className="tat-dot" style={{ background: p.color }} />{p.label.replace("أولوية ", "")}</> : "—"}</Td>
                            <Td>{e.account_manager_name || "—"}</Td>
                            <Td>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {canEdit && <MiniBtn onClick={() => doQuickAction(e.id, "reminder")}>{t("تذكير")}</MiniBtn>}
                                {canEdit && <MiniBtn onClick={() => doQuickAction(e.id, "email_reminder")}>{t("إيميل")}</MiniBtn>}
                                {canEdit && <MiniBtn onClick={() => setFollowUpTargetId(e.id)}>{t("متابعة")}</MiniBtn>}
                                {canEdit && status !== "paid" && <MiniBtn onClick={() => setPartialTargetId(e.id)}>{t("دفعة")}</MiniBtn>}
                                {canEdit && status !== "paid" && <MiniBtn onClick={() => doQuickAction(e.id, "confirm_payment")} color={GREEN}>{t("تأكيد✓")}</MiniBtn>}
                              </div>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {view === "report" && report && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
                <StatCard label={t("إجمالي المستحق")} value={formatMoney(report.totalDue, currency)} color={INK} />
                <StatCard label={t("إجمالي المحصّل")} value={formatMoney(report.totalCollected, currency)} color={GREEN} />
                <StatCard label={t("إجمالي المتبقي")} value={formatMoney(report.totalOutstanding, currency)} color={RED} />
                <StatCard label={t("نسبة التحصيل")} value={`${Number(report.rate).toFixed(1)}%`} color={GOLD} />
                <StatCard label={t("عملاء متأخرين")} value={report.overdueCount} color={report.overdueCount > 0 ? RED : GREEN} />
              </div>
              <div className="tat-card" style={{ overflow: "hidden" }}>
                <div style={{ background: "var(--surface-2)", color: "var(--ink-2)", padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>{t("أداء مديري الحسابات")}</div>
                {report.managerPerformance.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)" }}>{t("لا توجد بيانات كافية")}</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ fontSize: 12, color: "var(--ink-3)", borderBottom: "1px solid var(--border-soft)" }}>
                        <Th>{t("المسؤول")}</Th><Th>{t("عدد العملاء")}</Th><Th>{t("المحصّل")}</Th><Th>{t("المتبقي")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.managerPerformance.map((m, i) => (
                        <tr key={i} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                          <Td style={{ fontWeight: 600 }}>{m.manager_name || t("بدون تعيين")}</Td>
                          <Td>{m.clients}</Td>
                          <Td style={{ color: GREEN }}>{formatMoney(m.collected, currency)}</Td>
                          <Td style={{ color: RED }}>{formatMoney(m.outstanding, currency)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {detailData && (
        <DetailModal
          entry={detailData}
          today={today}
          onClose={closeDetail}
          onEdit={() => openEdit(detailData)}
          onQuickAction={(action) => doQuickAction(detailData.id, action)}
          onAddFollowUp={() => setFollowUpTargetId(detailData.id)}
          onPartialPayment={() => setPartialTargetId(detailData.id)}
        />
      )}

      {modalOpen && editingEntry && (
        <EntryFormModal entry={editingEntry} clients={clients} users={users} onClose={() => { setModalOpen(false); setEditingEntry(null); }} onSave={save} onDelete={editingEntry.id && can("collection", "delete") ? () => remove(editingEntry.id) : null} />
      )}

      {followUpTargetId && (
        <FollowUpModal onClose={() => setFollowUpTargetId(null)} onSave={(payload) => doFollowUp(followUpTargetId, payload)} />
      )}

      {partialTargetId && (
        <PartialPaymentModal onClose={() => setPartialTargetId(null)} onSave={(amount) => doPartialPayment(partialTargetId, amount)} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return <button type="button" className={`tat-tab${active ? " on" : ""}`} onClick={onClick}>{children}</button>;
}
function Th({ children }) { return <th style={{ textAlign: "right", padding: "10px 12px", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children, style, onClick }) { return <td onClick={onClick} style={{ padding: "10px 12px", whiteSpace: "nowrap", ...style }}>{children}</td>; }
function MiniBtn({ children, onClick, color }) {
  return <button onClick={(ev) => { ev.stopPropagation(); onClick(); }} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: color || INK, cursor: "pointer" }}>{children}</button>;
}

function DetailModal({ entry, today, onClose, onEdit, onQuickAction, onAddFollowUp, onPartialPayment }) {
  const canEdit = useAccount().can("collection", "edit");
  const status = paymentStatus(entry, today);
  const meta = STATUS_META[status];
  const p = priorityInfo(entry, today);
  const remaining = Number(entry.expected_amount) - Number(entry.amount_paid);
  const fs = FOLLOWUP_STATUSES.find((s) => s.id === entry.follow_up_status);

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={entry.client_name || entry.company_name} wide>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: tint(meta.color, 13), color: darken(meta.color) }}><span className="tat-dot" style={{ background: meta.color }} />{meta.label}</span>
            <span style={{ fontSize: 12 }}>{p.color && <span className="tat-dot" style={{ background: p.color }} />}{p.label}</span>
            {fs && <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: tint(fs.color, 13), color: darken(fs.color) }}>{fs.label}</span>}
            {entry.invoice_id && (
              <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: tint(TEAL, 13), color: darken(TEAL) }}>
                {t("مرتبط بفاتورة")} {entry.invoice_number || `#${entry.invoice_id}`}
              </span>
            )}
          </div>
          {canEdit && <button onClick={onEdit} style={btnStyle(TEAL)}>{t("تعديل")}</button>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
          <InfoBlock label={t("الشركة")} value={entry.company_name || "—"} />
          <InfoBlock label={t("الخدمة")} value={entry.service || "—"} />
          <InfoBlock label={t("المبلغ المتوقع")} value={formatMoney(entry.expected_amount, entry.currency)} />
          <InfoBlock label={t("المدفوع")} value={formatMoney(entry.amount_paid, entry.currency)} />
          <InfoBlock label={t("المتبقي")} value={<span style={{ color: remaining > 0 ? RED : GREEN, fontWeight: 700 }}>{formatMoney(remaining, entry.currency)}</span>} />
          <InfoBlock label={t("تاريخ الاستحقاق")} value={formatDateArabic(entry.due_date)} />
          <InfoBlock label={t("مدير الحساب")} value={entry.account_manager_name || "—"} />
          <InfoBlock label={t("آخر متابعة")} value={formatDateArabic(entry.last_follow_up_date)} />
        </div>

        {canEdit && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          <button onClick={() => onQuickAction("email_reminder")} style={{ ...btnStyle(TEAL), fontSize: 12.5, padding: "6px 12px" }}>{t("إرسال تذكير بالإيميل")}</button>
          <button onClick={() => onQuickAction("reminder")} style={{ ...btnStyle(GOLD), fontSize: 12.5, padding: "6px 12px" }}>{t("إرسال تذكير")}</button>
          <button onClick={() => onQuickAction("contacted")} style={{ ...btnStyle(TEAL), fontSize: 12.5, padding: "6px 12px" }}>{t("تحديد كـ\"تم التواصل\"")}</button>
          <button onClick={onAddFollowUp} style={{ ...btnStyle(NAVY), fontSize: 12.5, padding: "6px 12px" }}>{t("إضافة متابعة")}</button>
          {status !== "paid" && <button onClick={onPartialPayment} style={{ ...btnStyle(ORANGE), fontSize: 12.5, padding: "6px 12px" }}>{t("دفعة جزئية")}</button>}
          {status !== "paid" && <button onClick={() => onQuickAction("confirm_payment")} style={{ ...btnStyle(GREEN), fontSize: 12.5, padding: "6px 12px" }}>{t("تأكيد الدفع الكامل")}</button>}
        </div>}

        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{t("السجل الزمني")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(entry.timeline || []).length === 0 ? <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("لا يوجد سجل بعد")}</div> : entry.timeline.map((t) => (
            <div key={t.id} style={{ borderRight: `3px solid ${TEAL}`, paddingRight: 10 }}>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{formatDateArabic(t.date)}</div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label}</div>
              {t.note && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>"{t.note}"</div>}
            </div>
          ))}
        </div>
      </ModalShell>
    </Overlay>
  );
}

function EntryFormModal({ entry, clients, users, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(entry);
  const [clientInvoices, setClientInvoices] = useState([]);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.expected_amount;
  const isLinked = !!form.invoice_id;

  useEffect(() => {
    if (!form.client_id) { setClientInvoices([]); return; }
    let cancelled = false;
    api.listInvoices(`client_id=${form.client_id}`).then((invs) => {
      if (!cancelled) setClientInvoices(invs);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id]);

  const handleLinkInvoice = (invoiceId) => {
    if (!invoiceId) {
      update("invoice_id", "");
      return;
    }
    const inv = clientInvoices.find((i) => String(i.id) === String(invoiceId));
    setForm((f) => ({
      ...f,
      invoice_id: invoiceId,
      expected_amount: inv ? inv.amount : f.expected_amount,
      amount_paid: inv ? inv.paid_amount : f.amount_paid,
      due_date: inv ? inv.due_date?.slice(0, 10) : f.due_date,
    }));
  };

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={entry.id ? t("تعديل سجل التحصيل") : t("سجل تحصيل جديد")}>
        <FieldLabel>{t("العميل")}</FieldLabel>
        <select value={form.client_id || ""} onChange={(e) => { update("client_id", e.target.value); update("invoice_id", ""); }} style={inputStyle}>
          <option value="">{t("بدون ربط بعميل")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <FieldLabel>{t("ربط بفاتورة (اختياري)")}</FieldLabel>
        <select value={form.invoice_id || ""} onChange={(e) => handleLinkInvoice(e.target.value)} style={inputStyle} disabled={!form.client_id}>
          <option value="">{t("بدون ربط بفاتورة (متابعة مستقلة)")}</option>
          {clientInvoices.map((inv) => (
            <option key={inv.id} value={inv.id}>{inv.number} — {inv.amount}{" "}{t("جنيه")}</option>
          ))}
        </select>
        {isLinked && (
          <div style={{ fontSize: 11.5, color: TEAL, marginBottom: 8 }}>{t("المبلغ والاستحقاق متزامنين مع الفاتورة — أي دفعة تسجّلها هنا هتتحدّث في الفاتورة نفسها كمان.")}</div>
        )}

        <FieldLabel>{t("اسم الشركة")}</FieldLabel>
        <input value={form.company_name} onChange={(e) => update("company_name", e.target.value)} style={inputStyle} />
        <FieldLabel>{t("الخدمة")}</FieldLabel>
        <input value={form.service} onChange={(e) => update("service", e.target.value)} style={inputStyle} />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel>{t("المبلغ المتوقع (جنيه)")}</FieldLabel>
            <input type="number" value={form.expected_amount} onChange={(e) => update("expected_amount", e.target.value)} style={inputStyle} disabled={isLinked} />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel>{t("المبلغ المدفوع (جنيه)")}</FieldLabel>
            <input type="number" value={form.amount_paid} onChange={(e) => update("amount_paid", e.target.value)} style={inputStyle} disabled={isLinked} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel>{t("تاريخ الاستحقاق")}</FieldLabel>
            <input type="date" value={form.due_date} onChange={(e) => update("due_date", e.target.value)} style={inputStyle} disabled={isLinked} />
          </div>
          <div style={{ flex: 1 }}><FieldLabel>{t("مدير الحساب المسؤول")}</FieldLabel>
            <select value={form.account_manager_id || ""} onChange={(e) => update("account_manager_id", e.target.value)} style={inputStyle}>
              <option value="">{t("غير محدد")}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <FieldLabel>{t("حالة المتابعة")}</FieldLabel>
        <select value={form.follow_up_status} onChange={(e) => update("follow_up_status", e.target.value)} style={inputStyle}>
          {FOLLOWUP_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <FieldLabel>{t("المتابعة القادمة")}</FieldLabel>
        <input type="date" value={form.next_follow_up_date} onChange={(e) => update("next_follow_up_date", e.target.value)} style={inputStyle} />
        <FieldLabel>{t("آخر ملاحظة تواصل")}</FieldLabel>
        <textarea value={form.last_communication_notes} onChange={(e) => update("last_communication_notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!canSave} onClick={() => canSave && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: canSave ? 1 : 0.5 }}>{t("حفظ")}</button>
          {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
        </div>
      </ModalShell>
    </Overlay>
  );
}

function FollowUpModal({ onClose, onSave }) {
  const [date, setDate] = useState(toISODate(new Date()));
  const [method, setMethod] = useState("whatsapp");
  const [response, setResponse] = useState("");
  const [notes, setNotes] = useState("");
  const [nextDate, setNextDate] = useState("");

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={t("إضافة متابعة")}>
        <FieldLabel>{t("تاريخ المتابعة")}</FieldLabel>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        <FieldLabel>{t("وسيلة التواصل")}</FieldLabel>
        <select value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
          {COMM_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <FieldLabel>{t("رد العميل")}</FieldLabel>
        <input value={response} onChange={(e) => setResponse(e.target.value)} style={inputStyle} />
        <FieldLabel>{t("ملاحظات")}</FieldLabel>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        <FieldLabel>{t("المتابعة القادمة")}</FieldLabel>
        <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} style={inputStyle} />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={() => onSave({ date, method, client_response: response, notes, next_follow_up_date: nextDate })} style={{ ...btnStyle(GOLD), flex: 1 }}>{t("حفظ المتابعة")}</button>
        </div>
      </ModalShell>
    </Overlay>
  );
}

function PartialPaymentModal({ onClose, onSave }) {
  const [amount, setAmount] = useState("");
  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={t("تسجيل دفعة جزئية")}>
        <FieldLabel>{t("المبلغ")}</FieldLabel>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} autoFocus />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!amount} onClick={() => amount && onSave(amount)} style={{ ...btnStyle(GOLD), flex: 1, opacity: amount ? 1 : 0.5 }}>{t("حفظ")}</button>
        </div>
      </ModalShell>
    </Overlay>
  );
}
