import React, { useCallback, useEffect, useState } from "react";
import { api, notifyError, notifySuccess } from "../api/client";
import { GOLD, NAVY, RED, inputStyle, btnStyle } from "../theme";
import { Badge, LoadingBox } from "./Bits";
import { FieldLabel } from "./Modal";
import { Section, Row, Toggle, fmtDateTime } from "./SettingsParts";
import { t, locale, getLang } from "../i18n";

const EMPTY = { enabled: false, host: "", port: 587, secure: false, username: "", password: "", from_name: "", from_email: "", reply_to: "", notify_payment: false, notify_overdue: false };

const STATUS = { sent: ["var(--green)", "تم الإرسال"], queued: ["var(--orange)", "في الانتظار"], failed: ["var(--red)", "فشل"] };

/**
 * SMTP form. `scope` is "agency" (own SMTP overriding the platform default) or "platform"
 * (the default every agency falls back to — platform admins only).
 */
export default function EmailSettings({ scope = "agency", canEdit = true }) {
  const isPlatform = scope === "platform";
  const [form, setForm] = useState(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [log, setLog] = useState([]);

  const load = useCallback(async () => {
    try {
      const r = isPlatform ? await api.platformEmail() : await api.emailSettings();
      const s = r.settings;
      setForm(s ? { ...EMPTY, ...s, password: "" } : EMPTY);
      setHasPassword(!!(s && s.has_password));
      setPlatformAvailable(isPlatform ? true : !!r.platform_available);
      if (!isPlatform) setLog(await api.emailLog().catch(() => []));
    } catch (err) { notifyError(err); setForm(EMPTY); }
  }, [isPlatform]);
  useEffect(() => { load(); }, [load]);

  if (!form) return <LoadingBox rows={3} />;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const ro = !canEdit;

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, port: Number(form.port) };
      if (isPlatform) await api.platformSaveEmail(body); else await api.saveEmailSettings(body);
      notifySuccess(t("تم حفظ إعدادات البريد"));
      await load();
    } catch (err) { notifyError(err); } finally { setSaving(false); }
  };

  const resetToPlatform = async () => {
    if (!window.confirm(t("الرجوع لإعدادات المنصة؟ هيتمسح الـ SMTP الخاص بالوكالة."))) return;
    try { await api.deleteEmailSettings(); notifySuccess(t("اتمسحت إعدادات الوكالة")); await load(); } catch (err) { notifyError(err); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = isPlatform ? await api.platformTestEmail({ to: testTo || undefined, lang: getLang() }) : await api.testEmail({ to: testTo || undefined, lang: getLang() });
      notifySuccess(t("اتبعتت رسالة الاختبار إلى {to}", { to: r.to }));
      if (!isPlatform) setLog(await api.emailLog().catch(() => []));
    } catch (err) { notifyError(err); } finally { setTesting(false); }
  };

  return (
    <>
      {!isPlatform && (
        <div className="tat-card" style={{ padding: "12px 18px", marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Badge color={form.enabled ? "var(--green)" : platformAvailable ? "var(--teal)" : "var(--orange)"}>
            {form.enabled ? t("بيستخدم SMTP الوكالة") : platformAvailable ? t("بيستخدم SMTP المنصة") : t("مفيش SMTP مفعّل")}
          </Badge>
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {form.enabled ? t("الرسائل بتتبعت من خادمك الخاص.") : platformAvailable ? t("الرسائل بتتبعت عن طريق خادم المنصة. تقدر تفعّل SMTP خاص بيك من تحت.") : t("فعّل SMTP عشان الإيميلات (الدعوات، استعادة كلمة المرور، التذكيرات) تشتغل.")}
          </span>
        </div>
      )}

      <Section
        title={isPlatform ? t("SMTP المنصة (الافتراضي لكل الوكالات)") : t("خادم البريد (SMTP)")}
        hint={isPlatform ? t("بيُستخدم لأي وكالة معندهاش SMTP خاص.") : t("اختياري: لو فعّلته، الرسائل بتتبعت باسم وكالتك من خادمك.")}
        footer={canEdit && (
          <>
            <button type="button" onClick={save} disabled={saving} style={{ ...btnStyle(GOLD), opacity: saving ? 0.6 : 1 }}>{saving ? t("جارٍ الحفظ…") : t("حفظ")}</button>
            {!isPlatform && form.id && <button type="button" onClick={resetToPlatform} style={btnStyle(RED)}>{t("الرجوع لإعدادات المنصة")}</button>}
          </>
        )}
      >
        <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} disabled={ro} label={t("تفعيل SMTP")} />
        <Row>
          <div><FieldLabel>{t("الخادم (Host)")}</FieldLabel><input style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={form.host || ""} disabled={ro} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" /></div>
          <div><FieldLabel>{t("البورت")}</FieldLabel><input type="number" style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={form.port} disabled={ro} onChange={(e) => set("port", e.target.value)} /></div>
        </Row>
        <Toggle checked={form.secure} onChange={(v) => set("secure", v)} disabled={ro} label={t("اتصال مشفّر مباشر (SSL/TLS)")} hint={t("فعّله مع بورت 465 فقط. بورت 587 بيستخدم STARTTLS تلقائيًا.")} />
        <Row>
          <div><FieldLabel>{t("اسم المستخدم")}</FieldLabel><input style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={form.username || ""} disabled={ro} onChange={(e) => set("username", e.target.value)} autoComplete="off" /></div>
          <div><FieldLabel>{t("كلمة المرور")}</FieldLabel><input type="password" style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={form.password} disabled={ro} onChange={(e) => set("password", e.target.value)} placeholder={hasPassword ? t("محفوظة — اكتب لتغييرها") : ""} autoComplete="new-password" /></div>
        </Row>
        <Row>
          <div><FieldLabel>{t("اسم المرسل")}</FieldLabel><input style={inputStyle} value={form.from_name || ""} disabled={ro} onChange={(e) => set("from_name", e.target.value)} /></div>
          <div><FieldLabel>{t("إيميل المرسل")}</FieldLabel><input type="email" style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={form.from_email || ""} disabled={ro} onChange={(e) => set("from_email", e.target.value)} placeholder="noreply@example.com" /></div>
          <div><FieldLabel>{t("إيميل الرد (اختياري)")}</FieldLabel><input type="email" style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} value={form.reply_to || ""} disabled={ro} onChange={(e) => set("reply_to", e.target.value)} /></div>
        </Row>
      </Section>

      {!isPlatform && (
        <Section title={t("إشعارات المديرين بالإيميل")} hint={t("بتوصل لمديري الوكالة بلغة كل واحد فيهم.")}
          footer={canEdit && <button type="button" onClick={save} disabled={saving} style={{ ...btnStyle(GOLD), opacity: saving ? 0.6 : 1 }}>{t("حفظ")}</button>}>
          <Toggle checked={form.notify_payment} onChange={(v) => set("notify_payment", v)} disabled={ro} label={t("لما فاتورة تتسدد")} hint={t("إيميل فوري عند سداد فاتورة بالكامل.")} />
          <Toggle checked={form.notify_overdue} onChange={(v) => set("notify_overdue", v)} disabled={ro} label={t("ملخص الفواتير المتأخرة")} hint={t("إيميل يومي الساعة 7 صباحًا لو في فواتير اتأخرت جديد.")} />
        </Section>
      )}

      {canEdit && (
        <Section title={t("اختبار الإرسال")} hint={t("بيبعت رسالة حقيقية بالإعدادات الحالية (احفظ الأول).")}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input type="email" style={{ ...inputStyle, flex: "1 1 240px", maxWidth: 360, marginBottom: 0, direction: "ltr", textAlign: "left" }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={t("اتركه فاضي للإرسال لإيميلك")} />
            <button type="button" onClick={sendTest} disabled={testing} style={{ ...btnStyle(NAVY), opacity: testing ? 0.6 : 1 }}>{testing ? t("جارٍ الإرسال…") : t("إرسال رسالة اختبار")}</button>
          </div>
        </Section>
      )}

      {!isPlatform && (
        <Section title={t("سجل الرسائل")} hint={t("آخر 50 رسالة. الفاشلة بتتعاد تلقائيًا لحد 4 مرات.")}>
          {log.length === 0 ? <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("مفيش رسائل لسه")}</div> : (
            <div className="tat-scroll-x">
              <table style={{ width: "100%", minWidth: 560, fontSize: 13 }}>
                <thead><tr style={{ color: "var(--ink-3)", fontSize: 12 }}>{["الوقت", "إلى", "الموضوع", "الحالة"].map((h) => <th key={h} style={{ textAlign: "right", padding: "8px 10px" }}>{t(h)}</th>)}</tr></thead>
                <tbody>
                  {log.map((m) => {
                    const [c, l] = STATUS[m.status] || ["var(--ink-3)", m.status];
                    return (
                      <tr key={m.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "var(--ink-3)" }}>{fmtDateTime(m.created_at, locale())}</td>
                        <td className="tat-code" style={{ padding: "8px 10px" }}>{m.to_email}</td>
                        <td style={{ padding: "8px 10px" }}>{m.subject}</td>
                        <td style={{ padding: "8px 10px" }}><Badge color={c}>{t(l)}</Badge>{m.error && m.status !== "sent" ? <div style={{ fontSize: 11, color: "var(--ink-3)", maxWidth: 220 }}>{m.error}</div> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
