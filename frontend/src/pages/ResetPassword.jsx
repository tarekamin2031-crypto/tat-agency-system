import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { GOLD, inputStyle, btnStyle, INK } from "../theme";
import { t, getLang, setLanguage } from "../i18n";

// Two public screens in one file: "forgot password" (asks for the email) and
// "reset password" (opened from the emailed link, also used for invitations).
function Shell({ title, subtitle, children }) {
  return (
    <div className="tat-brand-bg" style={{ fontFamily: "var(--font-sans)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <button type="button" onClick={() => setLanguage(getLang() === "ar" ? "en" : "ar")} className="tat-btn-ghost" style={{ position: "absolute", top: 16, insetInlineEnd: 16 }}>{getLang() === "ar" ? "English" : "العربية"}</button>
      <div className="tat-card" style={{ padding: 32, width: "100%", maxWidth: 400, boxShadow: "0 30px 70px -20px rgba(0,0,0,0.6)" }}>
        <div className="tat-brand-bg" style={{ borderRadius: 10, padding: "16px 20px", marginBottom: 18, textAlign: "center" }}>
          <img src="/tat-logo-white.png" alt="TAT Agency" style={{ height: 48 }} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: INK }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 0 20px" }}>{subtitle}</div>
        {children}
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try { await api.forgotPassword(email); } catch { /* same answer either way */ }
    setSent(true);
    setLoading(false);
  };

  return (
    <Shell title={t("نسيت كلمة المرور؟")} subtitle={t("اكتب إيميلك وهنبعتلك رابط لإعادة التعيين.")}>
      {sent ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.8, color: "var(--ink-2)" }}>
          {t("لو الإيميل ده مسجّل عندنا، هيوصلك رابط خلال دقايق. الرابط صالح لمدة ساعة.")}
        </div>
      ) : (
        <form onSubmit={submit}>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 4 }}>{t("البريد الإلكتروني")}</div>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoFocus />
          <button type="submit" disabled={loading} style={{ ...btnStyle(GOLD), width: "100%", marginTop: 16, opacity: loading ? 0.6 : 1 }}>{loading ? t("جارٍ الإرسال…") : t("إرسال الرابط")}</button>
        </form>
      )}
      <div style={{ marginTop: 18, fontSize: 13 }}><Link to="/login" style={{ color: "var(--teal)" }}>{t("الرجوع لتسجيل الدخول")}</Link></div>
    </Shell>
  );
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (pw !== confirm) return setError(t("تأكيد كلمة المرور مش مطابق"));
    setLoading(true);
    try {
      await api.resetPassword(token, pw);
      setDone(true);
      setTimeout(() => navigate("/login"), 2200);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell title={t("تعيين كلمة مرور جديدة")} subtitle={t("8 حروف على الأقل، فيها حروف وأرقام.")}>
      {!token ? (
        <div style={{ color: "var(--red)", fontSize: 13.5 }}>{t("الرابط غير صالح أو انتهت صلاحيته")}</div>
      ) : done ? (
        <div style={{ color: "var(--green)", fontSize: 14, fontWeight: 600 }}>{t("تم تغيير كلمة المرور ✓ جارٍ تحويلك لتسجيل الدخول…")}</div>
      ) : (
        <form onSubmit={submit}>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 4 }}>{t("كلمة المرور الجديدة")}</div>
          <input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} style={inputStyle} autoComplete="new-password" autoFocus />
          <div style={{ fontSize: 12, color: "var(--ink-2)", margin: "10px 0 4px" }}>{t("تأكيد كلمة المرور الجديدة")}</div>
          <input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} autoComplete="new-password" />
          {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ ...btnStyle(GOLD), width: "100%", marginTop: 16, opacity: loading ? 0.6 : 1 }}>{loading ? t("جارٍ الحفظ…") : t("حفظ كلمة المرور")}</button>
        </form>
      )}
      <div style={{ marginTop: 18, fontSize: 13 }}><Link to="/login" style={{ color: "var(--teal)" }}>{t("الرجوع لتسجيل الدخول")}</Link></div>
    </Shell>
  );
}
