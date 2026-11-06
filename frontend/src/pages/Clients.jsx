import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { NAVY, GOLD, TEAL, RED, GREEN, inputStyle, btnStyle, darken, formatMoney, formatDateArabic, toISODate, INK, tint } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, InfoBlock, StatCard } from "../components/Bits";
import { useAccount } from "../context/AccountContext";
import { t } from "../i18n";

const CONTRACT_STATUSES = [
  { id: "active", get label() { return t("ساري"); }, color: GREEN },
  { id: "paused", get label() { return t("متوقف مؤقتاً"); }, color: "var(--ink-3)" },
  { id: "ended", get label() { return t("منتهي"); }, color: "#9CA3AF" },
];
const RENEWAL_CYCLES = [
  { id: "monthly", get label() { return t("شهري (يتجدد تلقائياً)"); } },
  { id: "quarterly", get label() { return t("كل 3 شهور"); } },
  { id: "yearly", get label() { return t("سنوي"); } },
  { id: "once", get label() { return t("مرة واحدة"); } },
];

function addMonths(iso, months) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return toISODate(d);
}

function nextRenewalDate(client, todayISO) {
  const cycle = client.renewal_cycle || "once";
  const cycleMonths = cycle === "monthly" ? 1 : cycle === "quarterly" ? 3 : cycle === "yearly" ? 12 : null;
  const anchor = client.contract_end || client.contract_start;
  if (!anchor) return null;
  if (!cycleMonths) return anchor;
  let next = anchor.slice(0, 10);
  let guard = 0;
  while (next < todayISO && guard < 600) {
    next = addMonths(next, cycleMonths);
    guard++;
  }
  return next;
}

function renewalInfo(client, today) {
  if (client.contract_status === "ended") return { get label() { return t("منتهي العقد"); }, color: "#9CA3AF" };
  if (client.contract_status === "paused") return { get label() { return t("متوقف مؤقتاً"); }, color: "var(--ink-3)" };
  const target = nextRenewalDate(client, today);
  if (!target) return { get label() { return t("بدون تاريخ"); }, color: "var(--border-strong)" };
  const days = Math.round((new Date(target) - new Date(today)) / 86400000);
  if (days < 0) return { label: t("متأخر {days} يوم", { days: Math.abs(days) }), color: RED, date: target };
  if (days <= 7) return { label: t("باقي {days} يوم", { days: days }), color: RED, date: target };
  if (days <= 30) return { label: t("باقي {days} يوم", { days: days }), color: GOLD, date: target };
  return { label: t("باقي {days} يوم", { days: days }), color: GREEN, date: target };
}

// Converts any contract value into its "per-month" share based on the
// renewal cycle, so quarterly/yearly contracts don't inflate a monthly total.
function monthlyValue(client) {
  const value = Number(client.contract_value) || 0;
  switch (client.renewal_cycle) {
    case "monthly": return value;
    case "quarterly": return value / 3;
    case "yearly": return value / 12;
    default: return 0; // "once" (one-time) contracts aren't recurring monthly revenue
  }
}

const emptyClient = () => ({
  name: "", industry: "", country: "مصر", contact_name: "", contact_phone: "", contact_email: "",
  contract_start: toISODate(new Date()), contract_end: "", contract_value: "", currency: "EGP",
  contract_status: "active", renewal_cycle: "monthly", notes: "",
});

export default function Clients() {
  const { can } = useAccount();
  const filters = useFilters();
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detailServices, setDetailServices] = useState([]);

  const today = toISODate(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, allServices] = await Promise.all([
        api.listClients(filters.toQueryString()),
        api.listServices(),
      ]);
      setClients(data);
      setServices(allServices);
      setError("");
    } catch (err) {
      setError(t("تعذر تحميل بيانات العملاء"));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const filtered = useMemo(() => {
    return clients.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));
  }, [clients, search]);

  // Group totals by currency so EGP/SAR/USD are never summed together.
  const analytics = useMemo(() => {
    const byCurrency = {};
    clients.forEach((c) => {
      const cur = c.currency || "—";
      if (!byCurrency[cur]) byCurrency[cur] = { totalContractValue: 0, monthlyValue: 0, activeCount: 0 };
      byCurrency[cur].totalContractValue += Number(c.contract_value) || 0;
      if (c.contract_status === "active") {
        byCurrency[cur].monthlyValue += monthlyValue(c);
        byCurrency[cur].activeCount += 1;
      }
    });
    return { byCurrency, totalClients: clients.length, activeClients: clients.filter((c) => c.contract_status === "active").length };
  }, [clients]);

  const openNew = () => { setEditing({ ...emptyClient(), selectedServiceIds: [] }); setModalOpen(true); };
  const openEdit = async (c) => {
    let selectedServiceIds = [];
    try {
      const assigned = await api.getClientServices(c.id);
      selectedServiceIds = assigned.map((s) => s.id);
    } catch (err) { /* non-critical — form still opens with no pre-selected services */ }
    setEditing({
      ...c,
      contract_start: c.contract_start ? c.contract_start.slice(0, 10) : "",
      contract_end: c.contract_end ? c.contract_end.slice(0, 10) : "",
      selectedServiceIds,
    });
    setModalOpen(true);
  };

  const save = async (form) => {
    try {
      const { selectedServiceIds, ...clientFields } = form;
      let clientId = form.id;
      if (clientId) await api.updateClient(clientId, clientFields);
      else {
        const created = await api.createClient(clientFields);
        clientId = created.id;
      }
      await api.setClientServices(clientId, selectedServiceIds || []);
      setModalOpen(false); setEditing(null);
      load();
      if (detailId === clientId) openDetailServices(clientId);
    } catch (err) {
      alert(t("حدث خطأ أثناء الحفظ: ") + err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm(t("متأكد من حذف هذا العميل؟"))) return;
    await api.deleteClient(id);
    setModalOpen(false); setEditing(null);
    if (detailId === id) setDetailId(null);
    load();
  };

  const openDetailServices = async (id) => {
    setDetailId(id);
    try {
      const assigned = await api.getClientServices(id);
      setDetailServices(assigned);
    } catch (err) {
      setDetailServices([]);
    }
  };

  const detailClient = clients.find((c) => c.id === detailId);

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("العملاء والعقود")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("إدارة بيانات العملاء والعقود والتجديد")}</div>
        </div>
        {can("clients", "create") && <button onClick={openNew} style={btnStyle(GOLD)}>{t("+ عميل جديد")}</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatCard label={t("إجمالي العملاء")} value={analytics.totalClients} color={INK} />
        <StatCard label={t("عملاء نشطين")} value={analytics.activeClients} color={TEAL} />
        {Object.entries(analytics.byCurrency).map(([currency, d]) => (
          <React.Fragment key={currency}>
            <StatCard label={t("إجمالي قيمة العقود ({currency})", { currency: currency })} value={formatMoney(d.totalContractValue, currency)} color={GOLD} />
            <StatCard label={t("الإيراد الشهري المقدر ({currency})", { currency: currency })} value={formatMoney(d.monthlyValue, currency)} color={GREEN} />
          </React.Fragment>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 20, marginTop: -12 }}>{t("الإيراد الشهري المقدر بياخد في الاعتبار دورة التجديد: العقود الشهرية بكامل قيمتها، الربع سنوية ÷3، السنوية ÷12، وعقود \"مرة واحدة\" مش بتتحسب كإيراد شهري متكرر.")}</div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ابحث باسم العميل...")} style={{ ...inputStyle, width: 260, marginBottom: 16 }} />

      {error && <div style={{ color: RED, marginBottom: 12 }}>{error}</div>}
      {loading ? (
        <EmptyBox>{t("جارٍ التحميل…")}</EmptyBox>
      ) : filtered.length === 0 ? (
        <EmptyBox>{t("لا يوجد عملاء مطابقين")}</EmptyBox>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {filtered.map((c) => {
            const r = renewalInfo(c, today);
            const cs = CONTRACT_STATUSES.find((s) => s.id === c.contract_status);
            return (
              <div key={c.id} onClick={() => openDetailServices(c.id)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRight: `4px solid ${r.color}`, borderRadius: 10, padding: 16, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{c.industry || "—"} · {c.country}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: tint((cs ? cs.color : "#999"), 13), color: darken(cs ? cs.color : "#999") }}>{cs ? cs.label : ""}</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 12.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "var(--ink-3)" }}>{t("التجديد")}</span>
                    <span style={{ color: r.color, fontWeight: 600 }}>{r.label}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--ink-3)" }}>{t("قيمة العقد")}</span>
                    <span>{formatMoney(c.contract_value, c.currency)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailClient && (
        <Overlay onClose={() => { setDetailId(null); setDetailServices([]); }}>
          <ModalShell onClose={() => { setDetailId(null); setDetailServices([]); }} title={detailClient.name} wide>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
              {can("clients", "edit") && <button onClick={() => openEdit(detailClient)} style={btnStyle(TEAL)}>{t("تعديل")}</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <InfoBlock label={t("جهة الاتصال")} value={detailClient.contact_name || "—"} />
              <InfoBlock label={t("الهاتف")} value={detailClient.contact_phone || "—"} />
              <InfoBlock label={t("البريد الإلكتروني")} value={detailClient.contact_email || "—"} />
              <InfoBlock label={t("بداية العقد")} value={formatDateArabic(detailClient.contract_start)} />
              <InfoBlock label={t("نهاية العقد")} value={formatDateArabic(detailClient.contract_end)} />
              <InfoBlock label={t("دورة التجديد")} value={RENEWAL_CYCLES.find((r) => r.id === detailClient.renewal_cycle)?.label || "—"} />
            </div>
            {detailClient.notes && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 4 }}>{t("ملاحظات")}</div>
                <div style={{ fontSize: 13, background: "var(--surface-2)", borderRadius: 6, padding: 10 }}>{detailClient.notes}</div>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 6 }}>{t("الخدمات")}</div>
              {detailServices.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("لا توجد خدمات معيّنة لهذا العميل")}</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {detailServices.map((s) => (
                    <span key={s.id} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, background: tint(TEAL, 13), color: darken(TEAL) }}>{s.name}</span>
                  ))}
                </div>
              )}
            </div>
          </ModalShell>
        </Overlay>
      )}

      {modalOpen && editing && (
        <ClientFormModal client={editing} services={services} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={save} onDelete={editing.id && can("clients", "delete") ? () => remove(editing.id) : null} />
      )}
    </div>
  );
}

function ClientFormModal({ client, services, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(client);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.name.trim().length > 0;

  const toggleService = (id) => {
    setForm((f) => {
      const current = f.selectedServiceIds || [];
      return {
        ...f,
        selectedServiceIds: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      };
    });
  };

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={client.id ? t("تعديل بيانات العميل") : t("عميل جديد")}>
        <FieldLabel>{t("اسم العميل")}</FieldLabel>
        <input value={form.name} onChange={(e) => update("name", e.target.value)} style={inputStyle} />

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("المجال")}</FieldLabel><input value={form.industry} onChange={(e) => update("industry", e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><FieldLabel>{t("الدولة")}</FieldLabel><input value={form.country} onChange={(e) => update("country", e.target.value)} style={inputStyle} /></div>
        </div>

        <FieldLabel>{t("جهة الاتصال")}</FieldLabel>
        <input value={form.contact_name} onChange={(e) => update("contact_name", e.target.value)} style={inputStyle} />

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("الهاتف")}</FieldLabel><input value={form.contact_phone} onChange={(e) => update("contact_phone", e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><FieldLabel>{t("البريد الإلكتروني")}</FieldLabel><input value={form.contact_email} onChange={(e) => update("contact_email", e.target.value)} style={inputStyle} /></div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("بداية العقد")}</FieldLabel><input type="date" value={form.contract_start} onChange={(e) => update("contract_start", e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><FieldLabel>{t("نهاية العقد")}</FieldLabel><input type="date" value={form.contract_end} onChange={(e) => update("contract_end", e.target.value)} style={inputStyle} /></div>
        </div>

        <FieldLabel>{t("دورة التجديد")}</FieldLabel>
        <select value={form.renewal_cycle} onChange={(e) => update("renewal_cycle", e.target.value)} style={inputStyle}>
          {RENEWAL_CYCLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FieldLabel>{t("قيمة العقد (جنيه مصري)")}</FieldLabel><input type="number" value={form.contract_value} onChange={(e) => update("contract_value", e.target.value)} style={inputStyle} /></div>
        </div>

        <FieldLabel>{t("حالة العقد")}</FieldLabel>
        <select value={form.contract_status} onChange={(e) => update("contract_status", e.target.value)} style={inputStyle}>
          {CONTRACT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        <FieldLabel>{t("الخدمات")}</FieldLabel>
        {services.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 8 }}>{t("لا توجد خدمات معرّفة بعد")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {services.map((s) => {
              const active = (form.selectedServiceIds || []).includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleService(s.id)}
                  style={{
                    fontSize: 12.5, padding: "6px 14px", borderRadius: 20,
                    border: `1px solid ${active ? TEAL : "var(--border)"}`,
                    background: active ? tint(TEAL, 13) : "var(--surface)",
                    color: active ? darken(TEAL) : "var(--ink-2)", cursor: "pointer",
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}

        <FieldLabel>{t("ملاحظات")}</FieldLabel>
        <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!canSave} onClick={() => canSave && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: canSave ? 1 : 0.5 }}>{t("حفظ")}</button>
          {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
        </div>
      </ModalShell>
    </Overlay>
  );
}
