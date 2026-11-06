import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { NAVY, NAVY_SOFT, GOLD, TEAL, RED, GREEN, inputStyle, btnStyle, darken, formatMoney, formatDateArabic, toISODate, INK, PILL } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, StatCard } from "../components/Bits";
import { useAccount } from "../context/AccountContext";
import { t, MONTHS } from "../i18n";

const PLATFORMS = [
  { id: "meta", get label() { return t("Meta (فيسبوك/انستجرام)"); } },
  { id: "google", label: "Google Ads" },
  { id: "tiktok", get label() { return t("تيك توك"); } },
  { id: "snapchat", get label() { return t("سناب شات"); } },
  { id: "other", get label() { return t("أخرى"); } },
];

const MONTHS_AR = MONTHS;
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}

function platformLabel(id) {
  return PLATFORMS.find((p) => p.id === id)?.label || id;
}

const emptyEntry = (clients) => ({
  client_id: clients[0]?.id || "", platform: "meta", amount_received: "", commission_rate: 20,
  received_date: toISODate(new Date()), notes: "",
});

export default function AdBudgets() {
  const { can } = useAccount();
  const filters = useFilters();
  const [entries, setEntries] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list");
  const [report, setReport] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filters.toQueryString();
      const [e, c] = await Promise.all([api.listAdBudgets(q), api.listClients(q)]);
      setEntries(e); setClients(c);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const loadReport = useCallback(async () => {
    const data = await api.adBudgetReport("EGP");
    setReport(data);
  }, []);

  useEffect(() => { if (view === "report") loadReport(); }, [view, loadReport]);

  const stats = useMemo(() => {
    const totalReceived = entries.reduce((s, e) => s + Number(e.amount_received), 0);
    const totalCommission = entries.reduce((s, e) => s + Number(e.commission_amount), 0);
    const totalNet = entries.reduce((s, e) => s + Number(e.net_ad_amount), 0);
    return { totalReceived, totalCommission, totalNet, count: entries.length };
  }, [entries]);

  const openNew = () => { setEditingEntry(emptyEntry(clients)); setModalOpen(true); };
  const openEdit = (e) => { setEditingEntry({ ...e, received_date: e.received_date?.slice(0, 10) }); setModalOpen(true); };

  const save = async (form) => {
    if (form.id) await api.updateAdBudget(form.id, form);
    else await api.createAdBudget(form);
    setModalOpen(false); setEditingEntry(null); load();
  };
  const remove = async (id) => {
    if (!confirm(t("متأكد من حذف هذا السجل؟"))) return;
    await api.deleteAdBudget(id);
    setModalOpen(false); setEditingEntry(null); load();
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("إعلانات العملاء")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("ميزانيات الإعلانات المستلمة من العملاء وعمولة الوكالة — العمولة بتتحسب ضمن دخل وأرباح الشركة")}</div>
        </div>
        {can("ad_budgets", "create") && <button onClick={openNew} style={btnStyle(GOLD)}>{t("+ ميزانية جديدة")}</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatCard label={t("إجمالي الميزانيات المستلمة")} value={formatMoney(stats.totalReceived, "EGP")} color={INK} />
        <StatCard label={t("إجمالي عمولة الوكالة")} value={formatMoney(stats.totalCommission, "EGP")} color={GOLD} />
        <StatCard label={t("إجمالي الصافي للحسابات الإعلانية")} value={formatMoney(stats.totalNet, "EGP")} color={GREEN} />
        <StatCard label={t("عدد العمليات")} value={stats.count} color={TEAL} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <TabBtn active={view === "list"} onClick={() => setView("list")}>{t("السجلات")}</TabBtn>
        <TabBtn active={view === "report"} onClick={() => setView("report")}>{t("تحليل")}</TabBtn>
      </div>

      {loading ? <EmptyBox>{t("جارٍ التحميل…")}</EmptyBox> : view === "list" ? (
        entries.length === 0 ? <EmptyBox>{t("لا توجد ميزانيات مسجلة بعد")}</EmptyBox> : (
          <div className="tat-card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--ink-2)", fontSize: 12 }}>
                  <Th>{t("العميل")}</Th><Th>{t("المنصة")}</Th><Th>{t("المبلغ المستلم")}</Th><Th>{t("نسبة العمولة")}</Th><Th>{t("عمولة الوكالة")}</Th><Th>{t("صافي الحساب الإعلاني")}</Th><Th>{t("التاريخ")}</Th>
                </tr>
              </thead>
              <tbody>
                {[...entries].sort((a, b) => b.received_date.localeCompare(a.received_date)).map((e) => (
                  <tr key={e.id} onClick={can("ad_budgets", "edit") ? () => openEdit(e) : undefined} style={{ borderTop: "1px solid var(--border-soft)", fontSize: 13, cursor: can("ad_budgets", "edit") ? "pointer" : "default" }}>
                    <Td style={{ fontWeight: 600 }}>{e.client_name || t("بدون عميل")}</Td>
                    <Td>{platformLabel(e.platform)}</Td>
                    <Td>{formatMoney(e.amount_received, "EGP")}</Td>
                    <Td>{Number(e.commission_rate)}%</Td>
                    <Td style={{ color: GOLD, fontWeight: 600 }}>{formatMoney(e.commission_amount, "EGP")}</Td>
                    <Td style={{ color: GREEN, fontWeight: 600 }}>{formatMoney(e.net_ad_amount, "EGP")}</Td>
                    <Td>{formatDateArabic(e.received_date)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : report && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="tat-card" style={{ overflow: "hidden" }}>
            <div style={{ background: "var(--surface-2)", color: "var(--ink-2)", padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>{t("حسب العميل")}</div>
            {report.byClient.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)" }}>{t("لا توجد بيانات")}</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ fontSize: 12, color: "var(--ink-3)", borderBottom: "1px solid var(--border-soft)" }}>
                    <Th>{t("العميل")}</Th><Th>{t("عدد العمليات")}</Th><Th>{t("إجمالي المستلم")}</Th><Th>{t("عمولة الوكالة")}</Th><Th>{t("صافي الإعلانات")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.byClient.map((r, i) => (
                    <tr key={i} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                      <Td style={{ fontWeight: 600 }}>{r.client_name || t("بدون عميل")}</Td>
                      <Td>{r.entry_count}</Td>
                      <Td>{formatMoney(r.total_received, "EGP")}</Td>
                      <Td style={{ color: GOLD }}>{formatMoney(r.total_commission, "EGP")}</Td>
                      <Td style={{ color: GREEN }}>{formatMoney(r.total_net, "EGP")}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="tat-card" style={{ overflow: "hidden" }}>
            <div style={{ background: "var(--surface-2)", color: "var(--ink-2)", padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>{t("حسب المنصة")}</div>
            {report.byPlatform.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)" }}>{t("لا توجد بيانات")}</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ fontSize: 12, color: "var(--ink-3)", borderBottom: "1px solid var(--border-soft)" }}>
                    <Th>{t("المنصة")}</Th><Th>{t("إجمالي المستلم")}</Th><Th>{t("عمولة الوكالة")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.byPlatform.map((r, i) => (
                    <tr key={i} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                      <Td style={{ fontWeight: 600 }}>{platformLabel(r.platform)}</Td>
                      <Td>{formatMoney(r.total_received, "EGP")}</Td>
                      <Td style={{ color: GOLD }}>{formatMoney(r.total_commission, "EGP")}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {report.byMonth.length > 0 && (
            <div className="tat-card" style={{ overflow: "hidden" }}>
              <div style={{ background: "var(--surface-2)", color: "var(--ink-2)", padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>{t("حسب الشهر (آخر 12 شهر)")}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ fontSize: 12, color: "var(--ink-3)", borderBottom: "1px solid var(--border-soft)" }}>
                    <Th>{t("الشهر")}</Th><Th>{t("إجمالي المستلم")}</Th><Th>{t("عمولة الوكالة")}</Th><Th>{t("صافي الإعلانات")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.byMonth].reverse().map((r, i) => (
                    <tr key={i} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                      <Td>{monthLabel(r.month)}</Td>
                      <Td>{formatMoney(r.total_received, "EGP")}</Td>
                      <Td style={{ color: GOLD }}>{formatMoney(r.total_commission, "EGP")}</Td>
                      <Td style={{ color: GREEN }}>{formatMoney(r.total_net, "EGP")}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modalOpen && editingEntry && (
        <EntryFormModal entry={editingEntry} clients={clients} onClose={() => { setModalOpen(false); setEditingEntry(null); }} onSave={save} onDelete={editingEntry.id && can("ad_budgets", "delete") ? () => remove(editingEntry.id) : null} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return <button type="button" className={`tat-tab${active ? " on" : ""}`} onClick={onClick}>{children}</button>;
}
function Th({ children }) { return <th style={{ textAlign: "right", padding: "10px 12px", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children, style }) { return <td style={{ padding: "10px 12px", whiteSpace: "nowrap", ...style }}>{children}</td>; }

function EntryFormModal({ entry, clients, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(entry);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.amount_received;

  const amount = Number(form.amount_received) || 0;
  const rate = Number(form.commission_rate) || 0;
  const commission = Math.round(amount * rate) / 100;
  const net = amount - commission;

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={entry.id ? t("تعديل ميزانية إعلانية") : t("ميزانية إعلانية جديدة")}>
        <FieldLabel>{t("العميل")}</FieldLabel>
        <select value={form.client_id || ""} onChange={(e) => update("client_id", e.target.value)} style={inputStyle}>
          <option value="">{t("بدون ربط بعميل")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <FieldLabel>{t("المنصة")}</FieldLabel>
        <select value={form.platform} onChange={(e) => update("platform", e.target.value)} style={inputStyle}>
          {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel>{t("المبلغ المستلم من العميل (EGP)")}</FieldLabel>
            <input type="number" value={form.amount_received} onChange={(e) => update("amount_received", e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel>{t("نسبة عمولة الوكالة (%)")}</FieldLabel>
            <input type="number" value={form.commission_rate} onChange={(e) => update("commission_rate", e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: 12, marginTop: 8, marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span>{t("عمولة الوكالة")}</span>
            <strong style={{ color: GOLD }}>{formatMoney(commission, "EGP")}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>{t("الصافي للحساب الإعلاني")}</span>
            <strong style={{ color: GREEN }}>{formatMoney(net, "EGP")}</strong>
          </div>
        </div>

        <FieldLabel>{t("تاريخ الاستلام")}</FieldLabel>
        <input type="date" value={form.received_date} onChange={(e) => update("received_date", e.target.value)} style={{ ...inputStyle, maxWidth: 200 }} />

        <FieldLabel>{t("ملاحظات")}</FieldLabel>
        <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!canSave} onClick={() => canSave && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: canSave ? 1 : 0.5 }}>{t("حفظ")}</button>
          {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
        </div>
      </ModalShell>
    </Overlay>
  );
}
