import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { GOLD, TEAL, RED, GREEN, ORANGE, inputStyle, btnStyle, formatMoney } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, LoadingBox, StatCard } from "../components/Bits";
import Icon from "../components/Icons";
import { useAccount } from "../context/AccountContext";
import { t } from "../i18n";

// Picks an icon + accent from the service name so each card feels distinct.
const SERVICE_STYLES = [
  [/سناب|تيك|لينكد|إكس|ميتا|جوجل|إعلان/, "megaphone", "var(--chart-3)"],
  [/سوشيال|ميديا/, "users", "var(--chart-1)"],
  [/فيديو/, "activity", "var(--chart-4)"],
  [/محتوى/, "invoice", "var(--chart-2)"],
  [/تصميم|جرافيك/, "widgets", "var(--chart-5)"],
  [/استشار|تسويق/, "chart", "var(--chart-2)"],
];
function styleFor(name) {
  const hit = SERVICE_STYLES.find(([re]) => re.test(name || ""));
  return hit ? { icon: hit[1], color: hit[2] } : { icon: "sliders", color: "var(--ink-3)" };
}

export default function ManageServices() {
  const { can } = useAccount();
  const [services, setServices] = useState([]);
  const [stats, setStats] = useState({}); // serviceId -> { clientCount, revenue }
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, perf] = await Promise.all([
        api.listServices(),
        api.financeByService("date_range=all&client_status=all").catch(() => []), // stats are a nice-to-have
      ]);
      setServices(data);
      const map = {};
      perf.forEach((r) => { if (r.serviceId != null) map[r.serviceId] = { clientCount: r.clientCount, revenue: r.revenue }; });
      setStats(map);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing({ name: "", description: "" }); setModalOpen(true); };
  const openEdit = (s) => { setEditing({ ...s }); setModalOpen(true); };

  const save = async (form) => {
    try {
      if (form.id) await api.updateService(form.id, form);
      else await api.createService(form);
      setModalOpen(false); setEditing(null);
      notifySuccess(t("تم حفظ الخدمة"));
      load();
    } catch (err) {
      notifyError(err);
    }
  };

  const remove = async (id) => {
    if (!confirm(t("متأكد من حذف الخدمة دي؟ لو عملاء مرتبطين بيها هيتشالوا منها."))) return;
    try {
      await api.deleteService(id);
      setModalOpen(false); setEditing(null);
      load();
    } catch (err) {
      notifyError(err);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? services.filter((s) => `${s.name} ${s.description || ""}`.toLowerCase().includes(q)) : services;
  }, [services, query]);

  const withClients = services.filter((s) => (stats[s.id]?.clientCount || 0) > 0).length;
  const totalClientLinks = services.reduce((sum, s) => sum + (stats[s.id]?.clientCount || 0), 0);

  return (
    <div style={{ padding: 28 }}>
      <div className="tat-page-head">
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("إدارة الخدمات")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("قائمة الخدمات المتاحة لربطها بالعملاء وتحليل الإيرادات")}</div>
        </div>
        <div className="tat-page-actions">
          {can("services", "create") && <button type="button" className="tat-btn-primary" onClick={openNew}><Icon name="plus" size={16} /><span>{t("خدمة جديدة")}</span></button>}
        </div>
      </div>

      {loading ? <LoadingBox rows={3} /> : services.length === 0 ? <EmptyBox>{t("لا توجد خدمات بعد")}</EmptyBox> : (
        <>
          <div className="tat-bento tat-rise">
            <div className="span-4"><StatCard icon="sliders" label={t("عدد الخدمات")} value={services.length} color={TEAL} /></div>
            <div className="span-4"><StatCard icon="checkCircle" label={t("خدمات مرتبطة بعملاء")} value={withClients} sub={t("من {length} خدمة", { length: services.length })} color={GREEN} /></div>
            <div className="span-4"><StatCard icon="users" label={t("إجمالي ارتباطات العملاء")} value={totalClientLinks} color={ORANGE} /></div>
          </div>

          <div className="tat-svc-toolbar">
            <div className="tat-sbox" style={{ maxWidth: 340 }}>
              <span className="tat-sbox-icon"><Icon name="search" size={17} /></span>
              <input className="tat-sbox-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ابحث في الخدمات…")} />
              {query && <button className="tat-sbox-clear" onClick={() => setQuery("")} aria-label={t("مسح")}>×</button>}
            </div>
            <span className="tat-label">{visible.length}{" "}{t("خدمة")}</span>
          </div>

          {visible.length === 0 ? <EmptyBox>{t("مفيش خدمات مطابقة لـ «")}{query}»</EmptyBox> : (
            <div className="tat-svc-grid tat-rise">
              {visible.map((s) => {
                const st = styleFor(s.name);
                const stat = stats[s.id];
                return (
                  <div key={s.id} className="tat-card lift tat-svc-card" role={can("services", "edit") ? "button" : undefined} tabIndex={can("services", "edit") ? 0 : undefined} onClick={can("services", "edit") ? () => openEdit(s) : undefined} onKeyDown={(e) => { if (e.key === "Enter" && can("services", "edit")) openEdit(s); }}>
                    <div className="head">
                      <span className="tat-ico" style={{ "--c": st.color, width: 42, height: 42, borderRadius: 13 }}><Icon name={st.icon} size={20} /></span>
                      <span className="edit" aria-hidden="true"><Icon name="settings" size={15} /></span>
                    </div>
                    <div className="name">{s.name}</div>
                    <div className="desc">{s.description || t("بدون وصف")}</div>
                    <div className="foot">
                      <span className="chip"><Icon name="users" size={13} />{stat ? stat.clientCount : 0}{" "}{t("عميل")}</span>
                      <span className="chip tat-num"><Icon name="banknote" size={13} />{formatMoney(stat ? stat.revenue : 0, "EGP")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {modalOpen && editing && (
        <ServiceModal service={editing} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={save} onDelete={editing.id && can("services", "delete") ? () => remove(editing.id) : null} />
      )}
    </div>
  );
}

function ServiceModal({ service, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(service);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.name.trim().length > 0;

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={service.id ? t("تعديل الخدمة") : t("خدمة جديدة")}>
        <FieldLabel>{t("اسم الخدمة")}</FieldLabel>
        <input value={form.name} onChange={(e) => update("name", e.target.value)} style={inputStyle} placeholder={t("مثال: إعلانات سناب شات")} />

        <FieldLabel>{t("وصف (اختياري)")}</FieldLabel>
        <textarea value={form.description || ""} onChange={(e) => update("description", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!canSave} onClick={() => canSave && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: canSave ? 1 : 0.5 }}>{t("حفظ")}</button>
          {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
        </div>
      </ModalShell>
    </Overlay>
  );
}
