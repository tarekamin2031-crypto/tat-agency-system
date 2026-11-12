import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { GOLD, TEAL, RED, GREEN, ORANGE, inputStyle, btnStyle } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, LoadingBox, StatCard, Badge } from "../components/Bits";
import Icon from "../components/Icons";
import { useAccount } from "../context/AccountContext";
import { t, monthNames } from "../i18n";

const STATUSES = ["todo", "doing", "done"];
const STATUS_LABEL = { get todo() { return t("جديد"); }, get doing() { return t("جاري"); }, get done() { return t("تم"); } };
const STATUS_COLOR = { todo: "var(--ink-3)", doing: ORANGE, done: GREEN };
const PRIORITY_LABEL = { get normal() { return t("عادية"); }, get high() { return t("مهمة"); }, get urgent() { return t("عاجلة"); } };
const PRIORITY_COLOR = { normal: "var(--ink-3)", high: ORANGE, urgent: RED };

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
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, cl, pe] = await Promise.all([
        api.listTasks(`month=${month}`),
        api.listClients().catch(() => []),
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
      && (!q || `${x.title} ${x.client_name} ${x.description || ""}`.toLowerCase().includes(q)));
  }, [tasks, clientFilter, assigneeFilter, query]);

  // per-client progress (over the month's tasks, ignoring the client filter so the strip stays usable)
  const progress = useMemo(() => {
    const map = new Map();
    tasks.forEach((x) => {
      if (assigneeFilter && (assigneeFilter === "none" ? x.assignee_id : String(x.assignee_id) !== assigneeFilter)) return;
      const e = map.get(x.client_id) || { id: x.client_id, name: x.client_name, total: 0, done: 0 };
      e.total += 1; if (x.status === "done") e.done += 1;
      map.set(x.client_id, e);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, assigneeFilter]);

  const total = visible.length;
  const done = visible.filter((x) => x.status === "done").length;
  const doing = visible.filter((x) => x.status === "doing").length;
  const overdue = visible.filter(isOverdue).length;

  const changeStatus = async (task, status) => {
    if (task.status === status) return;
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

  const openNew = () => setEditing({ client_id: clientFilter || "", title: "", description: "", status: "todo", priority: "normal", assignee_id: "", due_date: "", notes: "", linksText: "" });
  const openEdit = (x) => setEditing({ ...x, assignee_id: x.assignee_id || "", due_date: x.due_date || "", notes: x.notes || "", description: x.description || "", linksText: (x.links || []).join("\n") });

  return (
    <div style={{ padding: 28 }}>
      <div className="tat-page-head">
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t("التاسكات")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("المطلوب لكل عميل في كل شهر")}</div>
        </div>
        <div className="tat-page-actions">
          {can("tasks", "view") && <button type="button" className="tat-btn-ghost" onClick={() => setTemplatesOpen(true)}><Icon name="sliders" size={16} /><span>{t("القوالب الشهرية")}</span></button>}
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

      {loading ? <LoadingBox rows={3} /> : (
        <>
          <div className="tat-bento tat-rise">
            <div className="span-3"><StatCard icon="checkCircle" label={t("إجمالي التاسكات")} value={total} color={TEAL} /></div>
            <div className="span-3"><StatCard icon="activity" label={t("جاري")} value={doing} color={ORANGE} /></div>
            <div className="span-3"><StatCard icon="checkCircle" label={t("تم")} value={done} sub={total ? `${Math.round((done / total) * 100)}%` : undefined} color={GREEN} /></div>
            <div className="span-3"><StatCard icon="clock" label={t("متأخرة")} value={overdue} color={overdue ? RED : "var(--ink-3)"} /></div>
          </div>

          {progress.length > 0 && (
            <div className="tat-task-clients" role="list">
              {progress.map((p) => (
                <button key={p.id} type="button" role="listitem" className={`chip${String(p.id) === clientFilter ? " on" : ""}`} onClick={() => setClientFilter(String(p.id) === clientFilter ? "" : String(p.id))}>
                  <span className="n">{p.name}</span>
                  <span className="bar"><span style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
                  <span className="c tat-num">{p.done}/{p.total}</span>
                </button>
              ))}
            </div>
          )}

          {tasks.length === 0 ? (
            <EmptyBox>
              {t("مفيش تاسكات في الشهر ده.")}{" "}
              {can("tasks", "create") ? t("ضيف قوالب شهرية لعملائك واضغط «توليد تاسكات الشهر»، أو أضف تاسك يدويًا.") : ""}
            </EmptyBox>
          ) : (
            <div className="tat-kanban">
              {STATUSES.map((st) => {
                const col = visible.filter((x) => x.status === st);
                return (
                  <div
                    key={st}
                    className={`tat-kcol${overCol === st ? " over" : ""}`}
                    onDragOver={(e) => { if (can("tasks", "edit")) { e.preventDefault(); setOverCol(st); } }}
                    onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
                    onDrop={(e) => { e.preventDefault(); setOverCol(null); const task = tasks.find((x) => x.id === dragId); setDragId(null); if (task && can("tasks", "edit")) changeStatus(task, st); }}
                  >
                    <div className="tat-kcol-head">
                      <span className="tat-dot" style={{ background: STATUS_COLOR[st] }} />
                      <span className="name">{STATUS_LABEL[st]}</span>
                      <span className="count tat-num">{col.length}</span>
                    </div>
                    <div className="tat-kcol-body">
                      {col.length === 0 && <div className="tat-kcol-empty">{t("لا يوجد")}</div>}
                      {col.map((x) => (
                        <TaskCard key={x.id} task={x} canEdit={can("tasks", "edit")} dragging={dragId === x.id}
                          onDragStart={() => setDragId(x.id)} onDragEnd={() => { setDragId(null); setOverCol(null); }}
                          onOpen={() => openEdit(x)} onMove={(s) => changeStatus(x, s)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {editing && (
        <TaskModal task={editing} clients={clients} people={people} canEdit={editing.id ? can("tasks", "edit") : can("tasks", "create")}
          onClose={() => setEditing(null)} onSave={save} onDelete={editing.id && can("tasks", "delete") ? () => remove(editing.id) : null} />
      )}
      {templatesOpen && <TemplatesModal clients={clients} people={people} can={can} defaultClient={clientFilter} onClose={() => { setTemplatesOpen(false); }} />}
    </div>
  );
}

function TaskCard({ task, canEdit, dragging, onDragStart, onDragEnd, onOpen, onMove }) {
  const idx = STATUSES.indexOf(task.status);
  const overdue = isOverdue(task);
  return (
    <div className={`tat-tcard${dragging ? " dragging" : ""}${task.status === "done" ? " done" : ""}`} draggable={canEdit} onDragStart={onDragStart} onDragEnd={onDragEnd}
      role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <div className="client">{task.client_name}</div>
      <div className="title">{task.title}</div>
      <div className="meta">
        {task.priority !== "normal" && <Badge color={PRIORITY_COLOR[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>}
        {task.due_date && <span className={`due${overdue ? " late" : ""}`}><Icon name="calendar" size={12} />{task.due_date.slice(5).replace("-", "/")}</span>}
        {task.assignee_name && <span className="who"><Icon name="users" size={12} />{task.assignee_name}</span>}
        {(task.links || []).length > 0 && <span className="who"><Icon name="download" size={12} />{task.links.length}</span>}
      </div>
      {canEdit && (
        <div className="move" onClick={(e) => e.stopPropagation()}>
          {idx > 0 && <button type="button" onClick={() => onMove(STATUSES[idx - 1])}>{STATUS_LABEL[STATUSES[idx - 1]]}</button>}
          {idx < STATUSES.length - 1 && <button type="button" className="fwd" onClick={() => onMove(STATUSES[idx + 1])}>{STATUS_LABEL[STATUSES[idx + 1]]}</button>}
        </div>
      )}
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
function TemplatesModal({ clients, people, can, defaultClient, onClose }) {
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
