import React, { useCallback, useEffect, useState } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { GOLD, NAVY, RED, inputStyle, btnStyle } from "../theme";
import { Badge, EmptyBox, LoadingBox } from "./Bits";
import { Overlay, ModalShell, FieldLabel } from "./Modal";
import { Toggle, fmtDateTime } from "./SettingsParts";
import { t, locale } from "../i18n";

const EVENT_LABELS = {
  "invoice.created": "فاتورة جديدة",
  "invoice.paid": "فاتورة اتسددت",
  "invoice.overdue": "فاتورة اتأخرت",
  "client.created": "عميل جديد",
  "client.updated": "تعديل عميل",
  "renewal.upcoming": "تجديد قريب (خلال 7 أيام)",
  "payment.recorded": "دفعة اتسجلت",
};
const PLACEHOLDERS = ["{{message}}", "{{number}}", "{{client_name}}", "{{amount}}", "{{currency}}", "{{name}}", "{{days_overdue}}", "{{days_left}}", "{{payment_amount}}", "{{event}}"];

// Telegram preset: a GET to the Bot API. The message placeholder is filled (and URL-encoded) at send time.
const tgUrl = (token, chat) => `https://api.telegram.org/bot${token.trim()}/sendMessage?chat_id=${encodeURIComponent(chat.trim())}&text={{message}}`;
const parseTg = (url) => {
  const m = /\/bot([^/]+)\/sendMessage\?chat_id=([^&]*)/.exec(url || "");
  return m ? { tg_token: m[1], tg_chat: decodeURIComponent(m[2]) } : { tg_token: "", tg_chat: "" };
};
const blank = () => ({ kind: "custom", method: "POST", url: "", description: "", events: ["invoice.created", "invoice.paid"], message_template: "", tg_token: "", tg_chat: "" });
const STATUS = { success: ["var(--green)", "تم"], pending: ["var(--orange)", "في الانتظار"], failed: ["var(--red)", "فشل"] };

export default function WebhooksSection({ canEdit }) {
  const [list, setList] = useState(null);
  const [events, setEvents] = useState([]);
  const [modal, setModal] = useState(null); // null | { id?, url, description, events[] }
  const [saving, setSaving] = useState(false);
  const [secretShown, setSecretShown] = useState({});
  const [open, setOpen] = useState(null); // endpoint id whose deliveries are shown
  const [deliveries, setDeliveries] = useState([]);

  const load = useCallback(async () => {
    try { setList(await api.listWebhooks()); } catch (err) { notifyError(err); setList([]); }
  }, []);
  useEffect(() => { load(); api.webhookEvents().then(setEvents).catch(() => {}); }, [load]);

  const loadDeliveries = async (id) => {
    try { setDeliveries(await api.webhookDeliveries(id)); } catch (err) { notifyError(err); }
  };
  const toggleOpen = (id) => { if (open === id) { setOpen(null); return; } setOpen(id); setDeliveries([]); loadDeliveries(id); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const tg = modal.kind === "telegram";
      if (tg && (!modal.tg_token.trim() || !modal.tg_chat.trim())) throw new Error(t("اكتب Bot Token و Chat ID"));
      const body = {
        kind: modal.kind, method: tg ? "GET" : modal.method, url: tg ? tgUrl(modal.tg_token, modal.tg_chat) : modal.url,
        description: modal.description, events: modal.events, message_template: modal.message_template,
      };
      if (modal.id) await api.updateWebhook(modal.id, body); else await api.createWebhook(body);
      notifySuccess(t("تم حفظ الـ Webhook"));
      setModal(null);
      await load();
    } catch (err) { notifyError(err); } finally { setSaving(false); }
  };

  const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) notifySuccess(okMsg); return r; } catch (err) { notifyError(err); return null; } };

  const test = async (w) => {
    const r = await act(() => api.testWebhook(w.id));
    if (r) {
      if (r.status === "success") notifySuccess(t("وصلت رسالة الاختبار ✓ (كود {code})", { code: r.response_status }));
      else notifyError(new Error(t("فشل الاختبار: {err}", { err: r.error || `HTTP ${r.response_status}` })));
      await load(); if (open === w.id) loadDeliveries(w.id);
    }
  };

  const rotate = async (w) => {
    if (!window.confirm(t("تجديد المفتاح السري؟ لازم تحدّثه عند المستقبِل وإلا التوقيعات هتفشل."))) return;
    const r = await act(() => api.rotateWebhook(w.id), t("تم تجديد المفتاح"));
    if (r) { setSecretShown((s) => ({ ...s, [w.id]: true })); await load(); }
  };

  const remove = async (w) => {
    if (!window.confirm(t("حذف الـ Webhook ده وكل سجل تسليمه؟"))) return;
    await act(() => api.deleteWebhook(w.id), t("تم الحذف")); await load();
  };

  const copy = async (text) => { try { await navigator.clipboard.writeText(text); notifySuccess(t("اتنسخ")); } catch { notifyError(new Error(t("تعذر النسخ"))); } };

  const toggleEvent = (ev) => setModal((m) => {
    const has = m.events.includes(ev);
    return { ...m, events: has ? m.events.filter((x) => x !== ev) : [...m.events, ev] };
  });

  if (list === null) return <LoadingBox rows={3} />;

  return (
    <>
      <div className="tat-card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t("Webhooks (للأتمتة)")}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>{t("بنبعت طلب (POST أو GET) لرابطك كل ما يحصل حدث. تقدر توصله بتليجرام أو Zapier أو Make أو n8n.")}</div>
          </div>
          {canEdit && <button type="button" style={btnStyle(GOLD)} onClick={() => setModal(blank())}>{t("+ Webhook جديد")}</button>}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.8 }} className="tat-code">
          X-TAT-Signature: sha256=HMAC_SHA256(secret, timestamp + "." + body) · X-TAT-Timestamp · X-TAT-Event · X-TAT-Delivery
        </div>
      </div>

      {list.length === 0 ? <EmptyBox>{t("مفيش Webhooks لسه")}</EmptyBox> : list.map((w) => {
        const [c, l] = STATUS[w.last_status] || ["var(--ink-3)", "لم يُرسل بعد"];
        return (
          <div key={w.id} className="tat-card" style={{ padding: 18, marginBottom: 12, opacity: w.is_active ? 1 : 0.65 }}>
            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="tat-code" style={{ fontSize: 13.5, fontWeight: 700, wordBreak: "break-all" }}><span className="tat-badge" style={{ "--c": w.method === "GET" ? "var(--orange)" : "var(--green)", marginInlineEnd: 8 }}>{w.method || "POST"}</span>{w.kind === "telegram" ? `✈ Telegram — chat ${(/chat_id=([^&]*)/.exec(w.url) || [])[1] || ""}` : w.url}</div>
                {w.description && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{w.description}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {w.events.map((ev) => <span key={ev} className="tat-badge" style={{ "--c": "var(--teal)" }}>{ev === "*" ? t("كل الأحداث") : t(EVENT_LABELS[ev] || ev)}</span>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", alignSelf: "flex-start" }}>
                <Badge color={w.is_active ? c : "var(--ink-3)"}>{w.is_active ? t(l) : t("متوقف")}</Badge>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>✓ {w.success_count} · ✗ {w.failed_count}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("المفتاح السري")}:</span>
              <span className="tat-code" style={{ fontSize: 12.5 }}>{secretShown[w.id] ? w.secret : `${w.secret.slice(0, 6)}…${w.secret.slice(-4)}`}</span>
              {canEdit && w.secret && !w.secret.includes("…") && (
                <>
                  <button type="button" style={{ ...btnStyle("var(--ink-3)"), padding: "3px 10px", fontSize: 12 }} onClick={() => setSecretShown((s) => ({ ...s, [w.id]: !s[w.id] }))}>{secretShown[w.id] ? t("إخفاء") : t("إظهار")}</button>
                  <button type="button" style={{ ...btnStyle("var(--ink-3)"), padding: "3px 10px", fontSize: 12 }} onClick={() => copy(w.secret)}>{t("نسخ")}</button>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <button type="button" style={{ ...btnStyle(NAVY), padding: "5px 12px" }} onClick={() => toggleOpen(w.id)}>{open === w.id ? t("إخفاء السجل") : t("سجل التسليم")}</button>
              {canEdit && (
                <>
                  <button type="button" style={{ ...btnStyle(NAVY), padding: "5px 12px" }} onClick={() => test(w)}>{t("اختبار")}</button>
                  <button type="button" style={{ ...btnStyle(NAVY), padding: "5px 12px" }} onClick={() => setModal({ ...blank(), id: w.id, kind: w.kind || "custom", method: w.method || "POST", url: w.url, description: w.description || "", events: [...w.events], message_template: w.message_template || "", ...(w.kind === "telegram" ? parseTg(w.url) : {}) })}>{t("تعديل")}</button>
                  <button type="button" style={{ ...btnStyle(NAVY), padding: "5px 12px" }} onClick={() => rotate(w)}>{t("تجديد المفتاح")}</button>
                  <button type="button" style={{ ...btnStyle(w.is_active ? "var(--orange)" : "var(--green)"), padding: "5px 12px" }} onClick={async () => { await act(() => api.updateWebhook(w.id, { is_active: !w.is_active })); load(); }}>{w.is_active ? t("إيقاف") : t("تفعيل")}</button>
                  <button type="button" style={{ ...btnStyle(RED), padding: "5px 12px" }} onClick={() => remove(w)}>{t("حذف")}</button>
                </>
              )}
            </div>

            {open === w.id && (
              <div className="tat-scroll-x" style={{ marginTop: 14 }}>
                {deliveries.length === 0 ? <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("مفيش تسليمات لسه")}</div> : (
                  <table style={{ width: "100%", minWidth: 560, fontSize: 12.5 }}>
                    <thead><tr style={{ color: "var(--ink-3)" }}>{["الوقت", "الحدث", "الحالة", "المحاولات", "الرد", ""].map((h) => <th key={h} style={{ textAlign: "right", padding: "6px 8px" }}>{t(h)}</th>)}</tr></thead>
                    <tbody>
                      {deliveries.map((d) => {
                        const [dc, dl] = STATUS[d.status] || ["var(--ink-3)", d.status];
                        return (
                          <tr key={d.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                            <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: "var(--ink-3)" }}>{fmtDateTime(d.created_at, locale())}</td>
                            <td className="tat-code" style={{ padding: "6px 8px" }}>{d.event}</td>
                            <td style={{ padding: "6px 8px" }}><Badge color={dc}>{t(dl)}</Badge></td>
                            <td style={{ padding: "6px 8px" }}>{d.attempts}</td>
                            <td style={{ padding: "6px 8px", maxWidth: 220 }}>{d.response_status ? `HTTP ${d.response_status}` : (d.error || "—")}{d.status === "pending" && d.next_attempt_at ? <div style={{ color: "var(--ink-3)" }}>{t("إعادة المحاولة")}: {fmtDateTime(d.next_attempt_at, locale())}</div> : null}</td>
                            <td style={{ padding: "6px 8px" }}>{canEdit && d.status !== "success" && <button type="button" style={{ ...btnStyle(NAVY), padding: "3px 10px", fontSize: 12 }} onClick={async () => { await act(() => api.redeliverWebhook(d.id)); loadDeliveries(w.id); load(); }}>{t("إعادة إرسال")}</button>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}

      {modal && (
        <Overlay onClose={() => setModal(null)}>
          <ModalShell title={modal.id ? t("تعديل Webhook") : t("Webhook جديد")} onClose={() => setModal(null)}>
            <form onSubmit={save}>
              <FieldLabel>{t("النوع")}</FieldLabel>
              <div className="tat-seg" role="radiogroup">
                <button type="button" role="radio" aria-checked={modal.kind === "custom"} className={modal.kind === "custom" ? "on" : ""} onClick={() => setModal({ ...modal, kind: "custom" })}>{t("رابط مخصص (Zapier / Make / n8n…)")}</button>
                <button type="button" role="radio" aria-checked={modal.kind === "telegram"} className={modal.kind === "telegram" ? "on" : ""} onClick={() => setModal({ ...modal, kind: "telegram", method: "GET" })}>✈ Telegram</button>
              </div>

              {modal.kind === "telegram" ? (
                <>
                  <FieldLabel>Bot Token</FieldLabel>
                  <input required style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={modal.tg_token} onChange={(e) => setModal({ ...modal, tg_token: e.target.value })} placeholder="123456789:AA…" autoComplete="off" />
                  <FieldLabel>Chat ID</FieldLabel>
                  <input required style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={modal.tg_chat} onChange={(e) => setModal({ ...modal, tg_chat: e.target.value })} placeholder="-1001234567890" autoComplete="off" />
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.8, marginTop: 4 }}>
                    {t("اعمل بوت من @BotFather وخد الـ Token، ضيفه للجروب أو ابعتله رسالة، وجيب الـ Chat ID من @userinfobot أو من getUpdates. الرسالة بتتبعت بطريقة GET.")}
                  </div>
                </>
              ) : (
                <>
                  <FieldLabel>{t("طريقة الإرسال")}</FieldLabel>
                  <div className="tat-seg" role="radiogroup">
                    {["POST", "GET"].map((m) => <button key={m} type="button" role="radio" aria-checked={modal.method === m} className={modal.method === m ? "on" : ""} onClick={() => setModal({ ...modal, method: m })}>{m}</button>)}
                  </div>
                  <FieldLabel>{t("رابط الاستقبال (URL)")}</FieldLabel>
                  <input type="text" required style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={modal.url} onChange={(e) => setModal({ ...modal, url: e.target.value })} placeholder="https://hooks.example.com/…" />
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.8, marginTop: 4 }}>
                    {modal.method === "GET"
                      ? t("GET: لو الرابط فيه {{placeholders}} بتتملى (مثال ?text={{message}})، وإلا بنضيف الحقول تلقائيًا كـ query.")
                      : t("POST: بنبعت JSON موقّع (فيه الحقل message جاهز للقراءة). تقدر تستخدم {{placeholders}} في الرابط كمان.")}
                  </div>
                </>
              )}
              <FieldLabel>{t("وصف (اختياري)")}</FieldLabel>
              <input style={inputStyle} value={modal.description} onChange={(e) => setModal({ ...modal, description: e.target.value })} />
              <FieldLabel>{t("نص الرسالة (اختياري)")}</FieldLabel>
              <textarea rows={2} style={{ ...inputStyle, resize: "vertical" }} value={modal.message_template} onChange={(e) => setModal({ ...modal, message_template: e.target.value })} placeholder={t("اتركه فاضي لاستخدام رسالة جاهزة لكل حدث (بلغة الوكالة)")} />
              <div className="tat-code" style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.9 }}>{PLACEHOLDERS.join("  ")}</div>
              <FieldLabel>{t("الأحداث")}</FieldLabel>
              <Toggle checked={modal.events.includes("*")} onChange={(v) => setModal({ ...modal, events: v ? ["*"] : [] })} label={t("كل الأحداث")} />
              {!modal.events.includes("*") && events.map((ev) => (
                <Toggle key={ev} checked={modal.events.includes(ev)} onChange={() => toggleEvent(ev)} label={t(EVENT_LABELS[ev] || ev)} hint={ev} />
              ))}
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
