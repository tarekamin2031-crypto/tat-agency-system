import React, { useCallback, useEffect, useState } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { NAVY, GOLD, RED, inputStyle, btnStyle } from "../theme";
import { Badge, EmptyBox, LoadingBox, StatCard } from "../components/Bits";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { useAccount } from "../context/AccountContext";
import EmailSettings from "../components/EmailSettings";
import LeadsInbox from "../components/LeadsInbox";
import { t, locale } from "../i18n";

const NEW_AGENCY = { name: "", slug: "", max_users: 10, default_language: "ar", admin_name: "", admin_email: "", admin_password: "" };

const fmtDate = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(locale(), { dateStyle: "medium" }); } catch { return iso; }
};

export default function Platform() {
  const { isPlatformAdmin, agency } = useAccount();
  const [agencies, setAgencies] = useState(null);
  const [modal, setModal] = useState(null); // { mode: "create" } | { mode: "edit", agency }
  const [form, setForm] = useState(NEW_AGENCY);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("agencies");

  const load = useCallback(async () => {
    try { setAgencies(await api.platformAgencies()); } catch (err) { notifyError(err); setAgencies([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!isPlatformAdmin) return <div style={{ padding: 28 }}><EmptyBox>{t("الصفحة دي لإدارة المنصة بس")}</EmptyBox></div>;

  const openCreate = () => { setForm(NEW_AGENCY); setModal({ mode: "create" }); };
  const openEdit = (a) => { setForm({ ...NEW_AGENCY, name: a.name, max_users: a.max_users, default_language: a.default_language }); setModal({ mode: "edit", agency: a }); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await api.platformCreateAgency({
          name: form.name, slug: form.slug || undefined, max_users: Number(form.max_users), default_language: form.default_language,
          admin: { name: form.admin_name, email: form.admin_email, password: form.admin_password },
        });
        notifySuccess(t("تم إنشاء الوكالة ومديرها"));
      } else {
        await api.platformUpdateAgency(modal.agency.id, { name: form.name, max_users: Number(form.max_users), default_language: form.default_language });
        notifySuccess(t("تم حفظ التعديلات"));
      }
      setModal(null);
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (a) => {
    const next = !a.is_active;
    if (!next && !window.confirm(t("إيقاف وكالة \"{name}\"؟ كل مستخدميها هيتقفل عليهم الدخول لحد ما تفعّلها تاني.", { name: a.name }))) return;
    try {
      await api.platformUpdateAgency(a.id, { is_active: next });
      notifySuccess(next ? t("تم تفعيل الوكالة") : t("تم إيقاف الوكالة"));
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  const totals = (agencies || []).reduce((t, a) => ({
    active: t.active + (a.is_active ? 1 : 0), users: t.users + a.active_user_count, clients: t.clients + a.client_count,
  }), { active: 0, users: 0, clients: 0 });

  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("إدارة المنصة")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("كل الوكالات على النظام: إنشاء، إيقاف، وحد المستخدمين")}</div>
        </div>
        {tab === "agencies" && <button onClick={openCreate} style={btnStyle(GOLD)}>{t("+ وكالة جديدة")}</button>}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" className={`tat-tab${tab === "agencies" ? " on" : ""}`} onClick={() => setTab("agencies")}>{t("الوكالات")}</button>
        <button type="button" className={`tat-tab${tab === "leads" ? " on" : ""}`} onClick={() => setTab("leads")}>{t("طلبات التواصل")}</button>
        <button type="button" className={`tat-tab${tab === "email" ? " on" : ""}`} onClick={() => setTab("email")}>{t("البريد (SMTP المنصة)")}</button>
      </div>

      {tab === "leads" ? <LeadsInbox /> : tab === "email" ? <EmailSettings scope="platform" canEdit /> : agencies === null ? <LoadingBox rows={4} /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
            <StatCard label={t("الوكالات")} value={String(agencies.length)} color="var(--brand)" icon="table" sub={t("{active} نشطة", { active: totals.active })} />
            <StatCard label={t("المستخدمون النشطون")} value={String(totals.users)} color="var(--teal)" icon="users" />
            <StatCard label={t("العملاء (كل الوكالات)")} value={String(totals.clients)} color="var(--green)" icon="shield" />
          </div>

          {agencies.length === 0 ? <EmptyBox>{t("مفيش وكالات")}</EmptyBox> : (
            <div className="tat-card" style={{ overflow: "hidden" }}>
              <div className="tat-scroll-x">
                <table style={{ width: "100%", minWidth: 860 }}>
                  <thead>
                    <tr style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {[t("الوكالة"), t("المدير"), t("المستخدمون"), t("العملاء"), t("الفواتير"), t("آخر نشاط"), t("الحالة"), ""].map((h) => <th key={h} style={{ textAlign: "right", padding: "10px 14px" }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {agencies.map((a) => (
                      <tr key={a.id} style={{ fontSize: 13.5, borderTop: "1px solid var(--border-soft)", opacity: a.is_active ? 1 : 0.6 }}>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 700 }}>{a.name}{agency && a.id === agency.id ? t(" (وكالتك)") : ""}</div>
                          <div className="tat-code" style={{ fontSize: 11, color: "var(--ink-3)" }}>{a.slug || `#${a.id}`}</div>
                        </td>
                        <td className="tat-code" style={{ padding: "10px 14px", fontSize: 12.5 }}>{a.admin_email || "—"}</td>
                        <td style={{ padding: "10px 14px" }}>{a.active_user_count} / {a.max_users}</td>
                        <td style={{ padding: "10px 14px" }}>{a.client_count}</td>
                        <td style={{ padding: "10px 14px" }}>{a.invoice_count}</td>
                        <td style={{ padding: "10px 14px", color: "var(--ink-3)" }}>{fmtDate(a.last_activity_at)}</td>
                        <td style={{ padding: "10px 14px" }}><Badge color={a.is_active ? "var(--green)" : RED}>{a.is_active ? t("نشطة") : t("موقوفة")}</Badge></td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <button onClick={() => openEdit(a)} style={{ ...btnStyle(NAVY), padding: "5px 12px", marginInlineStart: 6 }}>{t("تعديل")}</button>
                          {!(agency && a.id === agency.id) && (
                            <button onClick={() => toggle(a)} style={{ ...btnStyle(a.is_active ? RED : "var(--green)"), padding: "5px 12px" }}>{a.is_active ? t("إيقاف") : t("تفعيل")}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {modal && (
        <Overlay onClose={() => setModal(null)}>
          <ModalShell title={modal.mode === "create" ? "وكالة جديدة" : t("تعديل {name}", { name: modal.agency.name })} onClose={() => setModal(null)}>
            <form onSubmit={save}>
              <FieldLabel>{t("اسم الوكالة")}</FieldLabel>
              <input style={inputStyle} value={form.name} onChange={f("name")} required />

              {modal.mode === "create" && (
                <>
                  <FieldLabel>{t("اسم مختصر للرابط (اختياري، حروف إنجليزي)")}</FieldLabel>
                  <input style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={form.slug} onChange={f("slug")} placeholder="my-agency" />
                </>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <FieldLabel>{t("الحد الأقصى للمستخدمين")}</FieldLabel>
                  <input type="number" min={1} max={10000} style={inputStyle} value={form.max_users} onChange={f("max_users")} required />
                </div>
                <div>
                  <FieldLabel>{t("اللغة الافتراضية")}</FieldLabel>
                  <select style={inputStyle} value={form.default_language} onChange={f("default_language")}>
                    <option value="ar">{t("العربية")}</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              {modal.mode === "create" && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 18, color: "var(--ink)" }}>{t("مدير الوكالة الأول")}</div>
                  <FieldLabel>{t("الاسم")}</FieldLabel>
                  <input style={inputStyle} value={form.admin_name} onChange={f("admin_name")} required />
                  <FieldLabel>{t("البريد الإلكتروني")}</FieldLabel>
                  <input type="email" style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={form.admin_email} onChange={f("admin_email")} required />
                  <FieldLabel>{t("كلمة المرور (8 حروف على الأقل)")}</FieldLabel>
                  <input type="password" minLength={8} style={inputStyle} value={form.admin_password} onChange={f("admin_password")} required autoComplete="new-password" />
                </>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button type="submit" disabled={saving} style={{ ...btnStyle(GOLD), opacity: saving ? 0.6 : 1 }}>{saving ? "جارٍ الحفظ…" : modal.mode === "create" ? t("إنشاء الوكالة") : t("حفظ")}</button>
                <button type="button" onClick={() => setModal(null)} style={btnStyle("var(--ink-3)")}>{t("إلغاء")}</button>
              </div>
            </form>
          </ModalShell>
        </Overlay>
      )}
    </div>
  );
}
