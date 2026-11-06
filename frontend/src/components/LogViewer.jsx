import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notifyError } from "../api/client";
import { inputStyle, btnStyle } from "../theme";
import { Badge, EmptyBox, LoadingBox } from "./Bits";
import { describeAction, actionTone } from "../utils/permLabels";
import { t, locale } from "../i18n";

const FIELD_LABELS = {
  get name() { return t("الاسم"); }, get email() { return t("الإيميل"); }, get phone() { return t("الهاتف"); }, get status() { return t("الحالة"); }, get amount() { return t("المبلغ"); }, get paid_amount() { return t("المدفوع"); }, get currency() { return t("العملة"); },
  get number() { return t("الرقم"); }, get description() { return t("الوصف"); }, get issue_date() { return t("تاريخ الإصدار"); }, get due_date() { return t("تاريخ الاستحقاق"); }, get date() { return t("التاريخ"); }, get category() { return t("التصنيف"); },
  get contract_value() { return t("قيمة العقد"); }, get renewal_cycle() { return t("دورة التجديد"); }, get is_active() { return t("نشط"); }, get role() { return t("الدور"); }, get permissions() { return t("الصلاحيات"); },
  get default_commission_rate() { return t("نسبة العمولة"); }, get max_users() { return t("الحد الأقصى للمستخدمين"); }, get default_language() { return t("اللغة"); }, get notes() { return t("ملاحظات"); },
};

const fmtValue = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? t("نعم") : t("لا");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

function Diff({ before, after }) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  if (!keys.length) return <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>{t("لا توجد تفاصيل محفوظة لهذا الحدث.")}</div>;
  return (
    <div className="tat-scroll-x">
      <table className="tat-diff">
        <thead><tr><th>{t("الحقل")}</th>{before && <th>{t("قبل")}</th>}{after && <th>{t("بعد")}</th>}</tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td style={{ fontWeight: 600 }}>{FIELD_LABELS[k] || k}</td>
              {before && <td className={after ? "old" : ""}>{fmtValue(before[k])}</td>}
              {after && <td className={before ? "new" : ""}>{fmtValue(after[k])}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
};

const EMPTY = { q: "", user_id: "", action: "", entity: "", from: "", to: "", agency_id: "" };

/**
 * Filterable, paginated activity log with an expandable before/after view.
 *   fetchLogs(queryString) -> { rows, total, page, pages }
 *   fetchFilters()         -> { actions, entities, users }
 *   agencies               -> optional [{id,name}] (platform view adds an agency filter + column)
 */
export default function LogViewer({ fetchLogs, fetchFilters, agencies = null }) {
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [options, setOptions] = useState({ actions: [], entities: [], users: [] });
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef(null);

  useEffect(() => { fetchFilters().then(setOptions).catch(() => {}); }, [fetchFilters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "30" });
      Object.entries(applied).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setData(await fetchLogs(qs.toString()));
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [applied, page, fetchLogs]);
  useEffect(() => { load(); }, [load]);

  // typing in the search box applies after a short pause; dropdowns apply at once
  const set = (key, value, delay = 0) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setPage(1); setApplied(next); }, delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const hasFilters = useMemo(() => Object.values(applied).some(Boolean), [applied]);
  const rows = data ? data.rows : [];

  return (
    <div>
      <div className="tat-log-filters">
        <input className="tat-field grow" style={inputStyle} placeholder={t("بحث (مستخدم، ملخص، رقم…)")} value={filters.q} onChange={(e) => set("q", e.target.value, 350)} />
        {agencies && (
          <select className="tat-field" style={inputStyle} value={filters.agency_id} onChange={(e) => set("agency_id", e.target.value)}>
            <option value="">{t("كل الوكالات")}</option>
            {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select className="tat-field" style={inputStyle} value={filters.user_id} onChange={(e) => set("user_id", e.target.value)}>
          <option value="">{t("كل المستخدمين")}</option>
          {options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="tat-field" style={inputStyle} value={filters.action} onChange={(e) => set("action", e.target.value)}>
          <option value="">{t("كل الأحداث")}</option>
          {options.actions.map((a) => <option key={a} value={a}>{describeAction(a).label}</option>)}
        </select>
        <select className="tat-field" style={inputStyle} value={filters.entity} onChange={(e) => set("entity", e.target.value)}>
          <option value="">{t("كل الأقسام")}</option>
          {options.entities.map((e) => <option key={e} value={e}>{describeAction(`${e}.`).entity}</option>)}
        </select>
        <input className="tat-field" type="date" style={inputStyle} value={filters.from} onChange={(e) => set("from", e.target.value)} aria-label={t("من تاريخ")} />
        <input className="tat-field" type="date" style={inputStyle} value={filters.to} onChange={(e) => set("to", e.target.value)} aria-label={t("إلى تاريخ")} />
        {hasFilters && <button type="button" style={btnStyle("var(--ink-3)")} onClick={() => { setFilters(EMPTY); setApplied(EMPTY); setPage(1); }}>{t("مسح الفلاتر")}</button>}
      </div>

      {loading && !data ? <LoadingBox rows={5} /> : rows.length === 0 ? <EmptyBox>{t("مفيش أحداث مطابقة")}</EmptyBox> : (
        <div className="tat-card" style={{ overflow: "hidden", opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <div className="tat-scroll-x">
            <table style={{ width: "100%", minWidth: 720 }}>
              <thead>
                <tr style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {[t("الوقت"), t("المستخدم"), t("الحدث"), t("التفاصيل"), ...(agencies ? [t("الوكالة")] : [])].map((h) => <th key={h} style={{ textAlign: "right", padding: "10px 14px" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const d = describeAction(l.action);
                  const expanded = open === l.id;
                  const hasDetail = l.before_data || l.after_data;
                  return (
                    <React.Fragment key={l.id}>
                      <tr className="tat-log-row" onClick={() => setOpen(expanded ? null : l.id)} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                        <td style={{ padding: "9px 14px", whiteSpace: "nowrap", color: "var(--ink-3)" }}>{fmtTime(l.created_at)}</td>
                        <td style={{ padding: "9px 14px" }}>
                          <div style={{ fontWeight: 600 }}>{l.user_name || l.user_email || "—"}</div>
                          {l.user_name && l.user_email && <div className="tat-code" style={{ fontSize: 11, color: "var(--ink-3)" }}>{l.user_email}</div>}
                        </td>
                        <td style={{ padding: "9px 14px", whiteSpace: "nowrap" }}><Badge color={actionTone(l.action)}>{d.label}</Badge></td>
                        <td style={{ padding: "9px 14px", color: "var(--ink-2)" }}>{l.summary || (l.entity_id ? `#${l.entity_id}` : "—")}</td>
                        {agencies && <td style={{ padding: "9px 14px", color: "var(--ink-3)" }}>{l.agency_name || "—"}</td>}
                      </tr>
                      {expanded && (
                        <tr style={{ background: "color-mix(in srgb, var(--ink) 3%, transparent)" }}>
                          <td colSpan={agencies ? 5 : 4} style={{ padding: "12px 18px" }}>
                            {hasDetail ? <Diff before={l.before_data} after={l.after_data} /> : <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>{t("لا توجد تفاصيل إضافية لهذا الحدث.")}</div>}
                            <div className="tat-code" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 10 }}>
                              {l.action}{l.entity_id ? ` · #${l.entity_id}` : ""}{l.ip ? ` · ${l.ip}` : ""}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 14, fontSize: 13 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ ...btnStyle("var(--ink-3)"), opacity: page <= 1 ? 0.4 : 1 }}>{t("السابق")}</button>
          <span style={{ color: "var(--ink-3)" }}>{t("صفحة")}{" "}{data.page}{" "}{t("من")}{" "}{data.pages} · {data.total}{" "}{t("حدث")}</span>
          <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)} style={{ ...btnStyle("var(--ink-3)"), opacity: page >= data.pages ? 0.4 : 1 }}>{t("التالي")}</button>
        </div>
      )}
    </div>
  );
}
