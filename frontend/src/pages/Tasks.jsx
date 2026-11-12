import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { GOLD, RED, GREEN, ORANGE, inputStyle, btnStyle } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, LoadingBox, Badge } from "../components/Bits";
import Icon from "../components/Icons";
import { useAccount } from "../context/AccountContext";
import { t, monthNames } from "../i18n";

const STATUSES = ["todo", "doing", "done"];
const NEXT = { todo: "doing", doing: "done", done: "todo" };
const STATUS_LABEL = { get todo() { return t("جديد"); }, get doing() { return t("جاري"); }, get done() { return t("تم"); } };
const STATUS_COLOR = { todo: "var(--ink-3)", doing: ORANGE, done: GREEN };
const PRIORITY_LABEL = { get normal() { return t("عادية"); }, get high() { return t("مهمة"); }, get urgent() { return t("عاجلة"); } };
const PRIORITY_COLOR = { normal: "var(--ink-3)", high: ORANGE, urgent: RED };
// Column order of the standard tasks; anything else (custom titles) follows alphabetically.
const STANDARD_ORDER = ["أفكار المحتوى", "Content Plan", "تصميمات", "إعلانات", "متابعة الإعلانات", "متابعة الاسكادول", "متابعة العميل (ميتنج)"];

const pad = (n) => String(n).padStart(2, "0");
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function shiftMonth(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthLabel(m) {
  const [y, mo] = m.split("-").map(Number);
  return `${monthNames()[mo - 1]} ${y}`;
}
const isOverdue = (task) => task.status !== "done" && task.due_date && task.due_date < todayISO();
const initials = (name) => String(name || "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function Tasks() {
  const { can } = useAccount();
  const [month, setMonth] = useState(currentMonth());
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // task object (id => edit, no id => new)
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [tplClient, setTplClient] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, cl, pe] = await Promise.all([
        api.listTasks(`month=${month}`),
        api.taskClients().catch(() => api.listClients().catch(() => [])),
        api.taskAssignees().catch(() => []),
      ]);
      setTasks(rows);
      setClients(cl);
      setPeople(pe);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((x) => (!clientFilter || String(x.client_id) === clientFilter)
      && (!assigneeFilter || (assigneeFilter === "none" ? !x.assignee_id : String(x.assignee_id) === assigneeFilter))
      && (!q || `${x.title} ${x.client_name}`.toLowerCase().includes(q)));
  }, [tasks, clientFilter, assigneeFilter, query]);

  // Matrix: rows = clients that have tasks this month, columns = distinct task titles.
  const { columns, rows } = useMemo(() => {
    const titles = [...new Set(visible.map((x) => x.title))];
    const rank = (ti) => { const i = STANDARD_ORDER.indexOf(ti); return i === -1 ? 1000 : i; };
    titles.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const byClient = new Map();
    visible.forEach((x) => {
      const e = byClient.get(x.client_id) || { id: x.client_id, name: x.client_name, cells: {}, total: 0, done: 0 };
      (e.cells[x.title] = e.cells[x.title] || []).push(x);
      e.total += 1; if (x.status === "done") e.done += 1;
      byClient.set(x.client_id, e);
    });
    return { columns: titles, rows: [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }, [visible]);

  const total = visible.length;
  const done = visible.filter((x) => x.status === "done").length;
  const doing = visible.filter((x) => x.status === "doing").length;
  const overdue = visible.filter(isOverdue).length;

  const changeStatus = async (task, status) => {
    const prev = tasks;
    setTasks((list) => list.map((x) => (x.id === task.id ? { ...x, status } : x))); // optimistic
    try {
      const saved = await api.updateTask(task.id, { status });
      setTasks((list) => list.map((x) => (x.id === task.id ? saved : x)));
    } catch (err) {
      setTasks(prev);
      notifyError(err);
    }
  };

  const addCell = async (client, title) => {
    try {
      await api.createTask({ client_id: client.id, month, title });
      load();
    } catch (err) { notifyError(err); }
  };

  const save = async (form) => {
    try {
      const payload = {
        title: form.title, description: form.description, status: form.status, priority: form.priority,
        assignee_id: form.assignee_id || null, due_date: form.due_date || null, notes: form.notes,
        links: String(form.linksText || "").split(/\s+/).filter(Boolean),
      };
      if (form.id) await api.updateTask(form.id, payload);
      else await api.createTask({ ...payload, client_id: Number(form.client_id), month });
      setEditing(null);
      notifySuccess(t("تم حفظ التاسك"));
      load();
    } catch (err) {
      notifyError(err);
    }
  };

  const remove = async (id) => {
    if (!confirm(t("متأكد من حذف التاسك ده؟"))) return;
    try { await api.deleteTask(id); setEditing(null); load(); } catch (err) { notifyError(err); }
  };

  const generate = async () => {
    try {
      const r = await api.generateTasks(month);
      notifySuccess(r.created ? t("تم توليد {n} تاسك من القوالب الشهرية", { n: r.created }) : t("مفيش تاسكات جديدة — كل قوالب الشهر متولدة بالفعل"));
      load();
    } catch (err) { notifyError(err); }
  };

  // One click: add the standard monthly tasks to every active client, then create this month's tasks.
  const applyDefaults = async () => {
    if (!confirm(t("هيتضاف التاسكات الأساسية (أفكار المحتوى، Content Plan، تصميمات، إعلانات، متابعة الإعلانات، متابعة الاسكادول، متابعة العميل) لكل العملاء النشطين، وبعدها تتولد تاسكات الشهر. أكمل؟"))) return;
    try {
      const s = await api.seedTaskTemplates(null);
      const g = await api.generateTasks(month);
      notifySuccess(t("اتضاف {t} قالب لـ {c} عميل، وتولّد {n} تاسك للشهر", { t: s.created, c: s.clients, n: g.created }));
      load();
    } catch (err) { notifyError(err); }
  };

  const openNew = () => setEditing({ client_id: clientFilter || "", title: "", description: "", status: "todo", priority: "normal", assignee_id: "", due_date: "", notes: "", linksText: "" });
  const openEdit = (x) => setEditing({ ...x, assignee_id: x.assignee_id || "", due_date: x.due_date || "", notes: x.notes || "", description: x.description || "", linksText: (x.links || []).join("\n") });

  const canEdit = can("tasks", "edit");

  return (
    <div style={{ padding: 28 }}>
      <div className="tat-page-head">
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("التاسكات")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("المطلوب لكل عميل في كل شهر")}</div>
        </div>
        <div className="tat-page-actions">
          {can("tasks", "view") && <button type="button" className="tat-btn-ghost" onClick={() => { setTplClient(clientFilter); setTemplatesOpen(true); }}><Icon name="sliders" size={16} /><span>{t("القوالب الشهرية")}</span></button>}
          {can("tasks", "create") && <button type="button" className="tat-btn-ghost" onClick={applyDefaults}><Icon name="checkCircle" size={16} /><span>{t("التاسكات الأساسية لكل العملاء")}</span></button>}
          {can("tasks", "create") && <button type="button" className="tat-btn-ghost" onClick={generate}><Icon name="refresh" size={16} /><span>{t("توليد تاسكات الشهر")}</span></button>}
          {can("tasks", "create") && <button type="button" className="tat-btn-primary" onClick={openNew}><Icon name="plus" size={16} /><span>{t("تاسك جديد")}</span></button>}
        </div>
      </div>

      <div className="tat-task-toolbar">
        <div className="tat-task-month">
          <button type="button" className="tat-icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("الشهر السابق")}><Icon name="chevron" size={16} style={{ transform: "rotate(-90deg)" }} /></button>
          <span className="label">{monthLabel(month)}</span>
          <button type="button" className="tat-icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("الشهر التالي")}><Icon name="chevron" size={16} style={{ transform: "rotate(90deg)" }} /></button>
          {month !== currentMonth() && <button type="button" className="tat-btn-ghost" onClick={() => setMonth(currentMonth())}>{t("الشهر الحالي")}</button>}
        </div>
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} style={{ ...inputStyle, width: "auto", marginBottom: 0, minWidth: 150 }} aria-label={t("العميل")}>
          <option value="">{t("كل العملاء")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} style={{ ...inputStyle, width: "auto", marginBottom: 0, minWidth: 150 }} aria-label={t("المسؤول")}>
          <option value="">{t("كل الفريق")}</option>
          <option value="none">{t("بدون مسؤول")}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="tat-sbox" style={{ maxWidth: 260, flex: "1 1 180px" }}>
          <span className="tat-sbox-icon"><Icon name="search" size={17} /></span>
          <input className="tat-sbox-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ابحث في التاسكات…")} />
          {query && <button className="tat-sbox-clear" onClick={() => setQuery("")} aria-label={t("مسح")}>×</button>}
        </div>
      </div>

      {loading ? <LoadingBox rows={3} /> : tasks.length === 0 ? (
        <EmptyBox>
          {t("مفيش تاسكات في الشهر ده.")}{" "}
          {can("tasks", "create") ? t("اضغط «التاسكات الأساسية لكل العملاء» عشان يتضاف المطلوب شهريًا لكل عميل ويتولد الشهر، أو أضف تاسك يدويًا.") : ""}
        </EmptyBox>
      ) : (
        <>
          <div className="tat-task-summary">
            <span><b className="tat-num">{total}</b>{t("إجمالي التاسكات")}</span>
            <span><i style={{ background: ORANGE }} /><b className="tat-num">{doing}</b>{t("جاري")}</span>
            <span><i style={{ background: GREEN }} /><b className="tat-num">{done}</b>{t("تم")}{total ? ` (${Math.round((done / total) * 100)}%)` : ""}</span>
            <span><i style={{ background: overdue ? RED : "var(--ink-3)" }} /><b className="tat-num">{overdue}</b>{t("متأخرة")}</span>
            <span className="legend"><i className="s-todo" />{t("جديد")} <i className="s-doing" />{t("جاري")} <i className="s-done" />{t("تم")} — {t("اضغط الخلية لتغيير الحالة")}</span>
          </div>

          <div className="tat-matrix-wrap">
            <table className="tat-matrix">
              <thead>
                <tr>
                  <th className="client">{t("العميل")}</th>
                  <th className="prog">{t("التقدّم")}</th>
                  {columns.map((c) => <th key={c}><span>{c}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th className="client" scope="row">
                      <div className="cname">
                        <button type="button" onClick={() => setClientFilter(String(r.id) === clientFilter ? "" : String(r.id))} title={r.name}>{r.name}</button>
                        {can("tasks", "view") && <button type="button" className="manage" onClick={() => { setTplClient(String(r.id)); setTemplatesOpen(true); }} aria-label={t("إدارة تاسكات العميل")} title={t("إدارة تاسكات العميل")}><Icon name="settings" size={13} /></button>}
                      </div>
                    </th>
                    <td className="prog"><span className="bar"><span style={{ width: `${(r.done / r.total) * 100}%` }} /></span><span className="tat-num c">{r.done}/{r.total}</span></td>
                    {columns.map((title) => {
                      const cell = r.cells[title];
                      if (!cell) {
                        return <td key={title} className="empty">{can("tasks", "create") ? <button type="button" className="add" onClick={() => addCell(r, title)} aria-label={t("إضافة")} title={t("إضافة")}>+</button> : <span>—</span>}</td>;
                      }
                      return (
                        <td key={title}>
                          {cell.map((x) => (
                            <div key={x.id} className={`cell s-${x.status}${isOverdue(x) ? " late" : ""}`}>
                              <button type="button" className="st" disabled={!canEdit} onClick={() => changeStatus(x, NEXT[x.status])}
                                title={`${STATUS_LABEL[x.status]}${x.due_date ? ` · ${x.due_date}` : ""}${x.assignee_name ? ` · ${x.assignee_name}` : ""}`}
                                aria-label={`${x.title} — ${STATUS_LABEL[x.status]}`}>
                                <Icon name={x.status === "done" ? "check" : x.status === "doing" ? "clock" : "minus"} size={14} />
                              </button>
                              <button type="button" className="more" onClick={() => openEdit(x)} aria-label={t("تفاصيل")} title={t("تفاصيل")}>
                                {x.assignee_name ? <span className="who">{initials(x.assignee_name)}</span> : <Icon name="settings" size={12} />}
                                {x.priority !== "normal" && <i className="pri" style={{ background: PRIORITY_COLOR[x.priority] }} />}
                              </button>
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <TaskModal task={editing} clients={clients} people={people} canEdit={editing.id ? can("tasks", "edit") : can("tasks", "create")}
          onClose={() => setEditing(null)} onSave={save} onDelete={editing.id && can("tasks", "delete") ? () => remove(editing.id) : null} />
      )}
      {templatesOpen && <TemplatesModal clients={clients} people={people} can={can} month={month} defaultClient={tplClient} onChanged={load} onClose={() => { setTemplatesOpen(false); }} />}
    </div>
  );
}

function TaskModal({ task, clients, people, canEdit, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(task);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const ok = form.title.trim().length > 0 && !!form.client_id;
  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={task.id ? t("تعديل التاسك") : t("تاسك جديد")}>
        <FieldLabel>{t("العميل")}</FieldLabel>
        <select value={form.client_id} onChange={(e) => update("client_id", e.target.value)} disabled={!!task.id || !canEdit} style={inputStyle}>
          <option value="">{t("اختر العميل")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <FieldLabel>{t("العنوان")}</FieldLabel>
        <input value={form.title} onChange={(e) => update("title", e.target.value)} style={inputStyle} disabled={!canEdit} placeholder={t("مثال: 12 بوست فيسبوك")} />

        <FieldLabel>{t("الوصف")}</FieldLabel>
        <textarea value={form.description} onChange={(e) => update("description", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} disabled={!canEdit} />

        <div className="tat-form-row">
          <div>
            <FieldLabel>{t("الحالة")}</FieldLabel>
            <select value={form.status} onChange={(e) => update("status", e.target.value)} style={inputStyle} disabled={!canEdit}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>{t("الأولوية")}</FieldLabel>
            <select value={form.priority} onChange={(e) => update("priority", e.target.value)} style={inputStyle} disabled={!canEdit}>
              {Object.keys(PRIORITY_LABEL).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
        </div>

        <div className="tat-form-row">
          <div>
            <FieldLabel>{t("المسؤول")}</FieldLabel>
            <select value={form.assignee_id} onChange={(e) => update("assignee_id", e.target.value)} style={inputStyle} disabled={!canEdit}>
              <option value="">{t("بدون مسؤول")}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>{t("الموعد النهائي")}</FieldLabel>
            <input type="date" value={form.due_date} onChange={(e) => update("due_date", e.target.value)} style={inputStyle} disabled={!canEdit} />
          </div>
        </div>

        <FieldLabel>{t("ملاحظات")}</FieldLabel>
        <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} disabled={!canEdit} />

        <FieldLabel>{t("روابط ملفات (رابط في كل سطر)")}</FieldLabel>
        <textarea value={form.linksText} onChange={(e) => update("linksText", e.target.value)} rows={2} dir="ltr" style={{ ...inputStyle, resize: "vertical" }} disabled={!canEdit} placeholder="https://drive.google.com/…" />
        {task.id && (task.links || []).length > 0 && (
          <div className="tat-task-links">{task.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer" dir="ltr">{l}</a>)}</div>
        )}

        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button disabled={!ok} onClick={() => ok && onSave(form)} style={{ ...btnStyle(GOLD), flex: 1, opacity: ok ? 1 : 0.5 }}>{t("حفظ")}</button>
            {onDelete && <button onClick={onDelete} style={btnStyle(RED)}>{t("حذف")}</button>}
          </div>
        )}
      </ModalShell>
    </Overlay>
  );
}

// Monthly recurring templates per client ("what we owe this client every month").
function TemplatesModal({ clients, people, can, month, defaultClient, onChanged, onClose }) {
  const [clientId, setClientId] = useState(defaultClient || (clients[0] ? String(clients[0].id) : ""));
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const blank = { title: "", priority: "normal", assignee_id: "", due_day: "" };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    if (!clientId) { setItems([]); return; }
    setLoading(true);
    try { setItems(await api.listTaskTemplates(`client_id=${clientId}`)); } catch (err) { notifyError(err); } finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.title.trim()) return;
    try {
      await api.createTaskTemplate({ client_id: Number(clientId), title: form.title, priority: form.priority, assignee_id: form.assignee_id || null, due_day: form.due_day || null });
      setForm(blank);
      load();
    } catch (err) { notifyError(err); }
  };
  const current = clients.find((c) => String(c.id) === String(clientId));
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { setEnabled(current ? current.tasks_enabled !== false : true); }, [current]);

  const toggleClient = async () => {
    try {
      const r = await api.setTaskClientEnabled(Number(clientId), !enabled);
      setEnabled(r.tasks_enabled);
      current && (current.tasks_enabled = r.tasks_enabled);
      notifySuccess(r.tasks_enabled ? t("اتفعّلت تاسكات العميل") : t("اتوقفت تاسكات العميل — مش هيتولد له تاسكات جديدة"));
      onChanged && onChanged();
    } catch (err) { notifyError(err); }
  };
  const removeClient = async () => {
    if (!confirm(t("حذف قوالب العميل «{name}» وتاسكاته في الشهر المعروض، وإيقاف التاسكات له؟ تاسكات الشهور السابقة هتفضل. مش هيتولد له تاسكات تاني لحد ما تفعّلها.", { name: current ? current.name : "" }))) return;
    try {
      const r = await api.removeTaskClient(Number(clientId), month);
      setEnabled(false);
      current && (current.tasks_enabled = false);
      notifySuccess(t("اتشال العميل: {a} قالب و{b} تاسك", { a: r.templates, b: r.tasks }));
      load();
      onChanged && onChanged();
    } catch (err) { notifyError(err); }
  };
  const addDefaults = async () => {
    try {
      const r = await api.seedTaskTemplates(Number(clientId));
      notifySuccess(r.created ? t("اتضاف {n} قالب أساسي", { n: r.created }) : t("القوالب الأساسية موجودة بالفعل"));
      setEnabled(true); current && (current.tasks_enabled = true);
      load();
      onChanged && onChanged();
    } catch (err) { notifyError(err); }
  };
  const toggle = async (x) => { try { await api.updateTaskTemplate(x.id, { active: !x.active }); load(); } catch (err) { notifyError(err); } };
  const remove = async (x) => {
    if (!confirm(t("حذف القالب؟ التاسكات اللي اتولدت منه قبل كده هتفضل موجودة."))) return;
    try { await api.deleteTaskTemplate(x.id); load(); } catch (err) { notifyError(err); }
  };

  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={t("القوالب الشهرية")} wide>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 8 }}>{t("اكتب مرة واحدة المطلوب شهريًا لكل عميل، والنظام يولّد التاسكات أوتوماتيك أول كل شهر.")}</div>
        <FieldLabel>{t("العميل")}</FieldLabel>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={inputStyle}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {clientId && (
          <div className="tat-tpl-state">
            <Badge color={enabled ? GREEN : "var(--ink-3)"}>{enabled ? t("التاسكات مفعّلة لهذا العميل") : t("التاسكات موقوفة لهذا العميل")}</Badge>
            {can("tasks", "edit") && <button type="button" className="tat-btn-ghost" onClick={toggleClient}>{enabled ? t("إيقاف التاسكات") : t("تفعيل التاسكات")}</button>}
            {can("tasks", "delete") && <button type="button" className="tat-btn-ghost danger" onClick={removeClient}>{t("حذف تاسكات العميل")}</button>}
          </div>
        )}

        {can("tasks", "create") && clientId && (
          <button type="button" className="tat-btn-ghost" onClick={addDefaults} style={{ marginTop: 8 }}><Icon name="checkCircle" size={16} /><span>{t("إضافة التاسكات الأساسية لهذا العميل")}</span></button>
        )}

        {loading ? <LoadingBox rows={2} /> : items.length === 0 ? <EmptyBox>{t("مفيش قوالب لعميل ده لسه")}</EmptyBox> : (
          <div className="tat-tpl-list">
            {items.map((x) => (
              <div key={x.id} className={`row${x.active ? "" : " off"}`}>
                <div className="t">{x.title}</div>
                <div className="m">
                  {x.priority !== "normal" && <Badge color={PRIORITY_COLOR[x.priority]}>{PRIORITY_LABEL[x.priority]}</Badge>}
                  {x.due_day && <span>{t("يوم {n}", { n: x.due_day })}</span>}
                  {x.assignee_name && <span>{x.assignee_name}</span>}
                </div>
                {can("tasks", "edit") && <button type="button" className="tat-btn-ghost" onClick={() => toggle(x)}>{x.active ? t("إيقاف") : t("تفعيل")}</button>}
                {can("tasks", "delete") && <button type="button" className="tat-icon-btn" onClick={() => remove(x)} aria-label={t("حذف")}><Icon name="close" size={16} /></button>}
              </div>
            ))}
          </div>
        )}

        {can("tasks", "create") && clientId && (
          <div className="tat-tpl-add">
            <FieldLabel>{t("قالب جديد")}</FieldLabel>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inputStyle} placeholder={t("مثال: تقرير الأداء الشهري")} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <div className="tat-form-row three">
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={inputStyle}>
                {Object.keys(PRIORITY_LABEL).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
              <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })} style={inputStyle}>
                <option value="">{t("بدون مسؤول")}</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} style={inputStyle} placeholder={t("يوم التسليم (1-31)")} />
            </div>
            <button type="button" className="tat-btn-primary" onClick={add} disabled={!form.title.trim()} style={{ marginTop: 8, opacity: form.title.trim() ? 1 : 0.5 }}><Icon name="plus" size={16} /><span>{t("إضافة القالب")}</span></button>
          </div>
        )}
      </ModalShell>
    </Overlay>
  );
}
