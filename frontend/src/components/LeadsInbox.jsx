import React, { useCallback, useEffect, useState } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { RED, inputStyle, btnStyle } from "../theme";
import { Badge, EmptyBox, LoadingBox } from "./Bits";
import { fmtDateTime } from "./SettingsParts";
import { t, locale } from "../i18n";

const STATUS = { new: ["var(--orange)", "جديد"], contacted: ["var(--teal)", "تم التواصل"], closed: ["var(--ink-3)", "مغلق"] };
const INTEREST = { demo: "عرض تجريبي", pricing: "الأسعار والباقات", question: "عندي سؤال", partnership: "شراكة / تعاون" };

// Contact / demo requests that arrive from the public landing page.
export default function LeadsInbox() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("");
  const [notes, setNotes] = useState({});

  const load = useCallback(async () => {
    try { setData(await api.platformLeads(filter)); } catch (err) { notifyError(err); setData({ leads: [], counts: {} }); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <LoadingBox rows={3} />;
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);

  const update = async (id, patch, msg) => {
    try { await api.platformUpdateLead(id, patch); if (msg) notifySuccess(msg); await load(); } catch (err) { notifyError(err); }
  };
  const remove = async (l) => {
    if (!window.confirm(t("حذف طلب {name} نهائيًا؟", { name: l.name }))) return;
    try { await api.platformDeleteLead(l.id); await load(); } catch (err) { notifyError(err); }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[["", t("الكل"), total], ["new", t("جديد"), data.counts.new || 0], ["contacted", t("تم التواصل"), data.counts.contacted || 0], ["closed", t("مغلق"), data.counts.closed || 0]].map(([id, label, n]) => (
          <button key={id} type="button" className={`tat-tab${filter === id ? " on" : ""}`} onClick={() => setFilter(id)}>{label} ({n})</button>
        ))}
      </div>

      {data.leads.length === 0 ? <EmptyBox>{t("مفيش طلبات تواصل لسه")}</EmptyBox> : data.leads.map((l) => {
        const [c, label] = STATUS[l.status] || ["var(--ink-3)", l.status];
        const wa = (l.phone || "").replace(/\D/g, "");
        return (
          <div key={l.id} className="tat-card" style={{ padding: 18, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{l.name}{l.company ? <span style={{ color: "var(--ink-3)", fontWeight: 500 }}> — {l.company}</span> : null}</div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginTop: 4 }}>
                  <a href={`mailto:${l.email}`} className="tat-code" style={{ color: "var(--teal)" }}>{l.email}</a>
                  {l.phone && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="tat-code" style={{ color: "var(--teal)" }}>{l.phone}</a>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", alignSelf: "flex-start" }}>
                <Badge color={c}>{t(label)}</Badge>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{fmtDateTime(l.created_at, locale())}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
              <span className="tat-badge" style={{ "--c": "var(--green)" }}>{t(INTEREST[l.interest] || l.interest)}</span>
              {l.team_size && <span className="tat-badge" style={{ "--c": "var(--teal)" }}>{l.team_size}</span>}
              <span className="tat-badge" style={{ "--c": "var(--ink-3)" }}>{l.lang === "en" ? "EN" : "AR"}</span>
            </div>
            {l.message && <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", padding: "10px 14px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border-soft)" }}>{l.message}</div>}
            <textarea rows={2} style={{ ...inputStyle, marginTop: 10, resize: "vertical" }} placeholder={t("ملاحظات داخلية…")} value={notes[l.id] ?? l.notes ?? ""} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} onBlur={() => notes[l.id] !== undefined && notes[l.id] !== (l.notes || "") && update(l.id, { notes: notes[l.id] }, t("تم حفظ الملاحظة"))} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {l.status !== "contacted" && <button type="button" style={{ ...btnStyle("var(--teal)"), padding: "5px 12px" }} onClick={() => update(l.id, { status: "contacted" })}>{t("تم التواصل")}</button>}
              {l.status !== "closed" && <button type="button" style={{ ...btnStyle("var(--ink-3)"), padding: "5px 12px" }} onClick={() => update(l.id, { status: "closed" })}>{t("إغلاق")}</button>}
              {l.status !== "new" && <button type="button" style={{ ...btnStyle("var(--orange)"), padding: "5px 12px" }} onClick={() => update(l.id, { status: "new" })}>{t("إعادة فتح")}</button>}
              <button type="button" style={{ ...btnStyle(RED), padding: "5px 12px", marginInlineStart: "auto" }} onClick={() => remove(l)}>{t("حذف")}</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
