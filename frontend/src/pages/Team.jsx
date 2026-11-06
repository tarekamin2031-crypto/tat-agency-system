import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { NAVY, GOLD, RED, inputStyle, btnStyle, formatDateArabic } from "../theme";
import { EmptyBox, LoadingBox, Badge } from "../components/Bits";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { useAccount } from "../context/AccountContext";
import { MODULE_LABELS, ACTION_LABELS } from "../utils/permLabels";
import { t } from "../i18n";

const EMPTY = { name: "", email: "", password: "", role_id: "", send_invite: false };

export default function Team() {
  const account = useAccount();
  const { can } = account;
  const me = account.me;
  const isAdmin = !!(me && me.isAgencyAdmin);
  const [tab, setTab] = useState("members");

  if (!can("team", "view")) {
    return <div style={{ padding: 28 }}><EmptyBox>{t("مفيش عندك صلاحية لصفحة الفريق")}</EmptyBox></div>;
  }

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{t("الفريق والصلاحيات")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("إضافة الأعضاء، تحديد دور كل عضو، وضبط ما يقدر يشوفه ويعدّله")}</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" className={`tat-tab${tab === "members" ? " on" : ""}`} onClick={() => setTab("members")}>{t("الأعضاء")}</button>
        <button type="button" className={`tat-tab${tab === "roles" ? " on" : ""}`} onClick={() => setTab("roles")}>{t("الأدوار والصلاحيات")}</button>
      </div>
      {tab === "members" ? <Members me={me} can={can} isAdmin={isAdmin} /> : <Roles isAdmin={isAdmin} />}
    </div>
  );
}

/* ------------------------------ Members ------------------------------ */

function Members({ me, can, isAdmin }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: "create" } | { mode: "edit", user }
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([api.listUsers(), api.listRoles()]);
      setUsers(u);
      setRoles(r.roles);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Only agency admins may hand out (or change) the admin role.
  const assignable = useMemo(() => roles.filter((r) => isAdmin || r.key !== "agency_admin"), [roles, isAdmin]);
  const defaultRoleId = () => String((roles.find((r) => r.key === "member") || assignable[0] || {}).id || "");

  const openCreate = () => { setForm({ ...EMPTY, role_id: defaultRoleId() }); setModal({ mode: "create" }); };
  const openEdit = (user) => { setForm({ name: user.name, email: user.email, password: "", role_id: String(user.role_id || "") }); setModal({ mode: "edit", user }); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal.mode === "create") {
        const created = await api.createUser({ ...form, role_id: Number(form.role_id) });
        notifySuccess(form.send_invite ? (created.invite_sent ? t("تمت إضافة العضو وبعتنا له دعوة بالإيميل") : t("تمت إضافة العضو لكن الدعوة ماتبعتتش — راجع إعدادات البريد")) : t("تمت إضافة العضو"));
      } else {
        const payload = { name: form.name };
        if (Number(form.role_id) !== modal.user.role_id) payload.role_id = Number(form.role_id);
        if (form.password) payload.password = form.password;
        await api.updateUser(modal.user.id, payload);
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

  const toggleActive = async (user) => {
    try {
      await api.updateUser(user.id, { is_active: !user.is_active });
      notifySuccess(user.is_active ? t("تم تعطيل الحساب") : t("تم تفعيل الحساب"));
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  // A non-admin can't edit an admin's account.
  const canEditRow = (u) => can("team", "edit") && (isAdmin || u.role_key !== "agency_admin");

  return (
    <>
      {can("team", "create") && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button onClick={openCreate} style={btnStyle(GOLD)}>{t("+ عضو جديد")}</button>
        </div>
      )}

      {loading ? <LoadingBox rows={3} /> : users.length === 0 ? <EmptyBox>{t("مفيش أعضاء")}</EmptyBox> : (
        <div className="tat-card tat-scroll-x" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", minWidth: 640 }}>
            <thead>
              <tr style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {[t("الاسم"), t("البريد الإلكتروني"), t("الدور"), t("الحالة"), t("آخر دخول"), ""].map((h) => (
                  <th key={h} style={{ textAlign: "right", padding: "10px 14px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ fontSize: 13.5, borderTop: "1px solid var(--border-soft)", opacity: u.is_active ? 1 : 0.55 }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{u.name}{u.id === me.id ? t(" (أنت)") : ""}</td>
                  <td style={{ padding: "10px 14px", direction: "ltr", textAlign: "right" }}>{u.email}</td>
                  <td style={{ padding: "10px 14px" }}><Badge color={u.role_key === "agency_admin" ? "var(--brand)" : "var(--teal)"}>{u.role_name ? t(u.role_name) : (u.role === "admin" ? t("مدير") : t("عضو"))}</Badge></td>
                  <td style={{ padding: "10px 14px", color: u.is_active ? "var(--green)" : RED, fontWeight: 600 }}>{u.is_active ? t("نشط") : t("معطّل")}</td>
                  <td style={{ padding: "10px 14px", color: "var(--ink-3)" }}>{u.last_login_at ? formatDateArabic(u.last_login_at) : "—"}</td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    {canEditRow(u) && <button onClick={() => openEdit(u)} style={{ ...btnStyle(NAVY), padding: "5px 12px", marginInlineStart: 6 }}>{t("تعديل")}</button>}
                    {canEditRow(u) && u.id !== me.id && (
                      <button onClick={() => toggleActive(u)} style={{ ...btnStyle(u.is_active ? RED : "var(--green)"), padding: "5px 12px" }}>
                        {u.is_active ? t("تعطيل") : t("تفعيل")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Overlay onClose={() => setModal(null)}>
          <ModalShell title={modal.mode === "create" ? t("عضو جديد") : t("تعديل العضو")} onClose={() => setModal(null)}>
            <form onSubmit={save}>
              <FieldLabel>{t("الاسم")}</FieldLabel>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />

              <FieldLabel>{t("البريد الإلكتروني")}</FieldLabel>
              <input type="email" style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={form.email} disabled={modal.mode === "edit"} onChange={(e) => setForm({ ...form, email: e.target.value })} required />

              <FieldLabel>{modal.mode === "create" ? t("كلمة المرور (8 حروف على الأقل)") : t("كلمة مرور جديدة (سيبها فاضية لو مش عايز تغيّرها)")}</FieldLabel>
              <input type="password" minLength={8} style={inputStyle} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={modal.mode === "create" && !form.send_invite} autoComplete="new-password" disabled={modal.mode === "create" && form.send_invite} />
              {modal.mode === "create" && (
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.send_invite} onChange={(e) => setForm({ ...form, send_invite: e.target.checked, password: e.target.checked ? "" : form.password })} style={{ width: 16, height: 16, accentColor: "var(--brand)" }} />
                  <span>{t("ابعت دعوة بالإيميل (العضو يحدد كلمة مروره بنفسه)")}</span>
                </label>
              )}

              <FieldLabel>{t("الدور")}</FieldLabel>
              <select style={inputStyle} value={form.role_id} disabled={modal.mode === "edit" && modal.user.id === me.id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} required>
                {assignable.map((r) => <option key={r.id} value={r.id}>{t(r.name)}</option>)}
              </select>
              {form.role_id && (
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>{t((roles.find((r) => String(r.id) === String(form.role_id)) || {}).description || "")}</div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button type="submit" disabled={saving} style={{ ...btnStyle(GOLD), opacity: saving ? 0.6 : 1 }}>{saving ? t("جارٍ الحفظ…") : t("حفظ")}</button>
                <button type="button" onClick={() => setModal(null)} style={btnStyle("var(--ink-3)")}>{t("إلغاء")}</button>
              </div>
            </form>
          </ModalShell>
        </Overlay>
      )}
    </>
  );
}

/* ------------------------------- Roles ------------------------------- */

function Roles({ isAdmin }) {
  const [data, setData] = useState(null); // { roles, modules, actions }
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null); // { name, description, permissions }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (keepId) => {
    try {
      const r = await api.listRoles();
      setData(r);
      const pick = r.roles.find((x) => x.id === keepId) || r.roles.find((x) => x.key !== "agency_admin") || r.roles[0];
      setSelectedId(pick ? pick.id : null);
    } catch (err) {
      notifyError(err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = data && data.roles.find((r) => r.id === selectedId);
  useEffect(() => {
    if (selected) setDraft({ name: selected.name, description: selected.description || "", permissions: JSON.parse(JSON.stringify(selected.permissions || {})) });
  }, [selected]);

  if (!data || !draft || !selected) return <LoadingBox rows={4} />;

  const locked = selected.key === "agency_admin";
  const readOnly = locked || !isAdmin;
  const dirty = JSON.stringify(draft) !== JSON.stringify({ name: selected.name, description: selected.description || "", permissions: selected.permissions || {} });

  const has = (m, a) => locked || (draft.permissions[m] || []).includes(a);
  const toggle = (m, a) => {
    if (readOnly) return;
    const cur = new Set(draft.permissions[m] || []);
    if (cur.has(a)) { cur.delete(a); if (a === "view") cur.clear(); } // no view => no access at all
    else { cur.add(a); cur.add("view"); }
    setDraft({ ...draft, permissions: { ...draft.permissions, [m]: [...cur] } });
  };
  const setRow = (m, on) => {
    if (readOnly) return;
    setDraft({ ...draft, permissions: { ...draft.permissions, [m]: on ? [...data.actions] : [] } });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateRole(selected.id, draft);
      notifySuccess(t("تم حفظ الصلاحيات"));
      await load(selected.id);
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const name = window.prompt(t("اسم الدور الجديد"));
    if (!name || !name.trim()) return;
    try {
      const role = await api.createRole({ name: name.trim(), permissions: { dashboard: ["view"] } });
      notifySuccess(t("تم إنشاء الدور"));
      await load(role.id);
    } catch (err) {
      notifyError(err);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("حذف دور \"{name}\"؟", { name: selected.name }))) return;
    try {
      await api.deleteRole(selected.id);
      notifySuccess(t("تم حذف الدور"));
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 250px) minmax(0, 1fr)", gap: 16, alignItems: "start" }} className="tat-roles-grid">
      <div className="tat-card" style={{ padding: 10 }}>
        {data.roles.map((r) => (
          <button
            key={r.id} type="button" onClick={() => setSelectedId(r.id)}
            style={{
              display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8, textAlign: "right",
              padding: "10px 12px", marginBottom: 4, borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
              border: "1px solid " + (r.id === selectedId ? "color-mix(in srgb, var(--green) 45%, transparent)" : "transparent"),
              background: r.id === selectedId ? "var(--green-bg)" : "transparent", color: r.id === selectedId ? "var(--green)" : "var(--ink)",
            }}
          >
            <span>{t(r.name)}{!r.is_system && <span style={{ fontSize: 10.5, color: "var(--ink-3)", marginInlineStart: 6 }}>{t("مخصص")}</span>}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500 }}>{r.user_count}</span>
          </button>
        ))}
        {isAdmin && <button onClick={create} style={{ ...btnStyle(GOLD), width: "100%", marginTop: 6 }}>{t("+ دور جديد")}</button>}
      </div>

      <div className="tat-card" style={{ padding: 18, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {readOnly || selected.is_system ? (
              <div style={{ fontSize: 17, fontWeight: 700 }}>{t(selected.name)}</div>
            ) : (
              <input style={{ ...inputStyle, fontWeight: 700, fontSize: 16, maxWidth: 320 }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            )}
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{t(selected.description || "دور مخصص")}</div>
          </div>
          {locked && <Badge color="var(--orange)">{t("ثابت — كل الصلاحيات دايمًا")}</Badge>}
          {!locked && !isAdmin && <Badge color="var(--ink-3)">{t("عرض فقط")}</Badge>}
        </div>

        <div className="tat-scroll-x" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 520, fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--ink-3)", fontSize: 12 }}>
                <th style={{ textAlign: "right", padding: "8px 10px" }}>{t("القسم")}</th>
                {data.actions.map((a) => <th key={a} style={{ padding: "8px 10px", textAlign: "center" }}>{ACTION_LABELS[a] || a}</th>)}
                <th style={{ padding: "8px 10px", textAlign: "center" }}>{t("الكل")}</th>
              </tr>
            </thead>
            <tbody>
              {data.modules.map((m) => {
                const all = data.actions.every((a) => has(m, a));
                return (
                  <tr key={m} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    <td style={{ padding: "9px 10px", fontWeight: 600 }}>
                      {MODULE_LABELS[m] || m}
                      {m === "personal_expenses" && <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 400 }}>{t("حساس — يُفضّل للمدير فقط")}</div>}
                    </td>
                    {data.actions.map((a) => (
                      <td key={a} style={{ textAlign: "center", padding: "9px 10px" }}>
                        <input type="checkbox" checked={has(m, a)} disabled={readOnly} onChange={() => toggle(m, a)} aria-label={`${MODULE_LABELS[m]} — ${ACTION_LABELS[a]}`} style={{ width: 17, height: 17, accentColor: "var(--brand)" }} />
                      </td>
                    ))}
                    <td style={{ textAlign: "center", padding: "9px 10px" }}>
                      <input type="checkbox" checked={all} disabled={readOnly} onChange={(e) => setRow(m, e.target.checked)} aria-label={t("{v1} — الكل", { v1: MODULE_LABELS[m] })} style={{ width: 17, height: 17, accentColor: "var(--brand)" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={save} disabled={!dirty || saving} style={{ ...btnStyle(GOLD), opacity: !dirty || saving ? 0.5 : 1 }}>{saving ? t("جارٍ الحفظ…") : t("حفظ الصلاحيات")}</button>
            {dirty && <button onClick={() => setDraft({ name: selected.name, description: selected.description || "", permissions: JSON.parse(JSON.stringify(selected.permissions || {})) })} style={btnStyle("var(--ink-3)")}>{t("تراجع")}</button>}
            {!selected.is_system && <button onClick={remove} style={{ ...btnStyle(RED), marginInlineStart: "auto" }}>{t("حذف الدور")}</button>}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>{t("التعديل بيسري فورًا على كل الأعضاء اللي على الدور ده. \"عرض\" شرط لأي صلاحية تانية في نفس القسم.")}</div>
      </div>
    </div>
  );
}
