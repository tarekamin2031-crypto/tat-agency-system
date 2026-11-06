import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setToken, setStoredUser } from "../api/client";
import { useAccount } from "../context/AccountContext";
import { NAVY, GOLD, CREAM, inputStyle, btnStyle, INK } from "../theme";
import { t, getLang, setLanguage } from "../i18n";

export default function Login() {
  const navigate = useNavigate();
  const account = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.login(email, password);
      setToken(data.token);
      setStoredUser(data.user);
      await account.refresh(); // loads this account's preferences, avatar and company details
      // "/" lets the app pick the user's start page, falling back to the first page their role can open
      navigate("/");
    } catch (err) {
      setError(t("البريد الإلكتروني أو كلمة المرور غير صحيحة"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tat-brand-bg" style={{ fontFamily: "var(--font-sans)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button type="button" onClick={() => setLanguage(getLang() === "ar" ? "en" : "ar")} className="tat-btn-ghost" style={{ position: "absolute", top: 16, insetInlineEnd: 16 }}>{getLang() === "ar" ? "English" : "العربية"}</button>
      <form onSubmit={submit} className="tat-card" style={{ padding: 32, width: "100%", maxWidth: 380, boxShadow: "0 30px 70px -20px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, color: INK }}>
          <div className="tat-brand-bg" style={{ borderRadius: 10, padding: "18px 20px", marginBottom: 14, textAlign: "center" }}>
            <img src="/tat-logo-white.png" alt="TAT Agency" style={{ height: 56 }} />
            <div className="tat-tagline" style={{ marginTop: 10 }}>Social Media Agency</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 24 }}>{t("تسجيل الدخول لنظام إدارة الأعمال")}</div>

        <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 4 }}>{t("البريد الإلكتروني")}</div>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} required />

        <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 4, marginTop: 10 }}>{t("كلمة المرور")}</div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} required />

        {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</div>}
        <div style={{ marginTop: 10, fontSize: 12.5 }}><Link to="/forgot-password" style={{ color: "var(--teal)" }}>{t("نسيت كلمة المرور؟")}</Link></div>

        <button type="submit" disabled={loading} style={{ ...btnStyle(GOLD), width: "100%", marginTop: 20, opacity: loading ? 0.6 : 1 }}>
          {loading ? t("جارٍ الدخول…") : t("دخول")}
        </button>
      </form>
    </div>
  );
}
