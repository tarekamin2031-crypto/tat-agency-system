import React, { useEffect, useRef, useState } from "react";
import { api, notifyError, notifySuccess, setToken } from "../api/client";
import { useAccount } from "../context/AccountContext";
import { INK, GOLD, RED, btnStyle, inputStyle, formatDateArabic } from "../theme";
import { FieldLabel } from "../components/Modal";
import { LoadingBox } from "../components/Bits";
import Icon from "../components/Icons";
import { NAV_GROUPS } from "../components/navItems";
import { t, getLang, locale } from "../i18n";
import EmailSettings from "../components/EmailSettings";
import WebhooksSection from "../components/WebhooksSection";

const DATE_OPTIONS = [
  ["today", "اليوم"], ["this_week", "هذا الأسبوع"], ["this_month", "هذا الشهر"], ["last_month", "الشهر الماضي"],
  ["last_3_months", "آخر 3 شهور"], ["last_6_months", "آخر 6 شهور"], ["this_year", "هذا العام"], ["last_year", "العام الماضي"], ["all", "كل الفترات"],
];
const STATUS_OPTIONS = [["all", "كل الحالات"], ["Active", "العملاء النشطين"], ["Suspended", "متوقفين مؤقتًا"], ["Stopped", "متوقفين"], ["Expired", "منتهية عقودهم"]];
const START_PAGES = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !["/team", "/settings"].includes(i.to));

// Reads an image file and scales it down in the browser (keeps uploads small).
function fileToDataUrl(file, { maxSide, type }) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("تعذر قراءة الملف")));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(t("الملف مش صورة صالحة")));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(type, 0.88));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function strength(pw) {
  let n = 0;
  if (pw.length >= 8) n++;
  if (pw.length >= 12) n++;
  if (/[A-Za-z؀-ۿ]/.test(pw) && /\d/.test(pw)) n++;
  if (/[^A-Za-z0-9؀-ۿ]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) n++;
  return n; // 0..4
}

function Section({ title, hint, children, footer }) {
  return (
    <div className="tat-card" style={{ padding: 24, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>{hint}</div>}
      <div style={{ marginTop: 16 }}>{children}</div>
      {footer && <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{footer}</div>}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="tat-seg" role="radiogroup">
      {options.map(([id, label]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? "on" : ""} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

function Row({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "4px 16px" }}>{children}</div>;
}

/* ---------------------------------------------------------------- Profile */
function ProfileSection() {
  const { profile, avatarUrl, refresh } = useAccount();
  const [form, setForm] = useState({ name: "", phone: "", email: "", current_password: "" });
  const [saving, setSaving] = useState(false);
  const [busyAvatar, setBusyAvatar] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (profile) setForm((f) => ({ ...f, name: profile.name || "", phone: profile.phone || "", email: profile.email || "" }));
  }, [profile]);

  if (!profile) return <LoadingBox rows={2} />;
  const emailChanged = form.email.trim().toLowerCase() !== profile.email.toLowerCase();

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, phone: form.phone };
      if (emailChanged) { payload.email = form.email; payload.current_password = form.current_password; }
      const res = await api.updateMe(payload);
      if (res.token) setToken(res.token);
      setForm((f) => ({ ...f, current_password: "" }));
      await refresh({ applyFilters: false });
      notifySuccess(t("تم حفظ بياناتك"));
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async (file) => {
    if (!file) return;
    setBusyAvatar(true);
    try {
      await api.uploadAvatar(await fileToDataUrl(file, { maxSide: 256, type: "image/jpeg" }));
      await refresh({ applyFilters: false });
      notifySuccess(t("تم تحديث الصورة"));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusyAvatar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const removeAvatar = async () => {
    setBusyAvatar(true);
    try { await api.deleteAvatar(); await refresh({ applyFilters: false }); notifySuccess(t("تم حذف الصورة")); }
    catch (err) { notifyError(err); }
    finally { setBusyAvatar(false); }
  };

  return (
    <form onSubmit={save}>
      <Section title={t("الصورة الشخصية")} hint={t("تظهر في القائمة الجانبية. PNG أو JPG أو WebP.")}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div className="tat-avatar big">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : (profile.name || "?").trim().charAt(0).toUpperCase()}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
            <button type="button" disabled={busyAvatar} onClick={() => fileRef.current?.click()} style={btnStyle(GOLD)}>{avatarUrl ? t("تغيير الصورة") : t("رفع صورة")}</button>
            {avatarUrl && <button type="button" disabled={busyAvatar} onClick={removeAvatar} style={{ ...btnStyle("transparent"), color: INK, border: "1px solid var(--border-strong)", boxShadow: "none" }}>{t("حذف")}</button>}
          </div>
        </div>
      </Section>

      <Section
        title={t("البيانات الأساسية")}
        footer={<button type="submit" disabled={saving} style={{ ...btnStyle(GOLD), opacity: saving ? 0.6 : 1 }}>{saving ? t("جارٍ الحفظ…") : t("حفظ التغييرات")}</button>}
      >
        <Row>
          <div><FieldLabel>{t("الاسم")}</FieldLabel><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><FieldLabel>{t("رقم الهاتف")}</FieldLabel><input style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+20…" /></div>
          <div><FieldLabel>{t("البريد الإلكتروني (اسم المستخدم)")}</FieldLabel><input type="email" style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div><FieldLabel>{t("الصلاحية")}</FieldLabel><input style={{ ...inputStyle, opacity: 0.7 }} value={profile.roleName ? t(profile.roleName) : (profile.role === "admin" ? t("مدير") : t("عضو"))} disabled /></div>
        </Row>
        {emailChanged && (
          <div style={{ marginTop: 8, maxWidth: 360 }}>
            <FieldLabel>{t("كلمة المرور الحالية (مطلوبة لتغيير الإيميل)")}</FieldLabel>
            <input type="password" style={inputStyle} value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} autoComplete="current-password" required />
          </div>
        )}
        <div className="tat-label" style={{ marginTop: 14 }}>{t("عضو من")}{" "}{formatDateArabic(profile.created_at)}</div>
      </Section>
    </form>
  );
}

/* --------------------------------------------------------------- Security */
function SecuritySection() {
  const { profile, refresh } = useAccount();
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [outBusy, setOutBusy] = useState(false);
  const score = strength(f.new_password);
  const LEVELS = [[t("ضعيفة جدًا"), RED], [t("ضعيفة"), RED], [t("مقبولة"), "var(--orange)"], [t("جيدة"), "var(--green)"], [t("قوية"), "var(--green)"]];

  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.confirm) return notifyError(new Error(t("تأكيد كلمة المرور مش مطابق")));
    setSaving(true);
    try {
      const res = await api.changePassword({ current_password: f.current_password, new_password: f.new_password });
      setToken(res.token); // this device stays signed in; every other session is closed
      setF({ current_password: "", new_password: "", confirm: "" });
      await refresh({ applyFilters: false });
      notifySuccess(t("تم تغيير كلمة المرور وتسجيل الخروج من باقي الأجهزة"));
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const logoutAll = async () => {
    if (!confirm(t("هيتم تسجيل خروجك من كل الأجهزة التانية. متأكد؟"))) return;
    setOutBusy(true);
    try { const res = await api.logoutAll(); setToken(res.token); notifySuccess(t("تم تسجيل الخروج من الأجهزة الأخرى")); }
    catch (err) { notifyError(err); }
    finally { setOutBusy(false); }
  };

  return (
    <>
      <form onSubmit={submit}>
        <Section
          title={t("تغيير كلمة المرور")}
          hint={t("8 حروف على الأقل، فيها حروف وأرقام. بعد التغيير بيتقفل الدخول من باقي الأجهزة.")}
          footer={<button type="submit" disabled={saving || !f.current_password || !f.new_password} style={{ ...btnStyle(GOLD), opacity: saving || !f.current_password || !f.new_password ? 0.55 : 1 }}>{saving ? t("جارٍ التغيير…") : t("تغيير كلمة المرور")}</button>}
        >
          <div style={{ maxWidth: 420 }}>
            <FieldLabel>{t("كلمة المرور الحالية")}</FieldLabel>
            <input type="password" style={inputStyle} value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" />
            <FieldLabel>{t("كلمة المرور الجديدة")}</FieldLabel>
            <input type="password" style={inputStyle} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" />
            {f.new_password && (
              <div style={{ margin: "6px 0 2px" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {[0, 1, 2, 3].map((i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i < score ? LEVELS[score][1] : "var(--border)" }} />)}
                </div>
                <div style={{ fontSize: 11.5, color: LEVELS[score][1], marginTop: 4 }}>{LEVELS[score][0]}</div>
              </div>
            )}
            <FieldLabel>{t("تأكيد كلمة المرور الجديدة")}</FieldLabel>
            <input type="password" style={{ ...inputStyle, borderColor: f.confirm && f.confirm !== f.new_password ? RED : undefined }} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" />
          </div>
        </Section>
      </form>

      <Section title={t("الجلسات والنشاط")} hint={t("لو شكيت إن حد دخل حسابك، اقفل كل الأجهزة التانية وغيّر كلمة المرور.")}>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <div className="tat-kv"><span>{t("آخر تغيير لكلمة المرور")}</span><b>{profile?.password_changed_at ? formatDateArabic(profile.password_changed_at) : "لم تتغير من الإنشاء"}</b></div>
          <div className="tat-kv"><span>{t("آخر دخول سابق")}</span><b>{profile?.prev_login_at ? new Date(profile.prev_login_at).toLocaleString(locale()) : "—"}</b></div>
          <div className="tat-kv"><span>{t("الدخول الحالي")}</span><b>{profile?.last_login_at ? new Date(profile.last_login_at).toLocaleString(locale()) : "—"}</b></div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button type="button" disabled={outBusy} onClick={logoutAll} style={{ ...btnStyle("transparent"), color: RED, border: "1px solid var(--red)", boxShadow: "none" }}>{t("تسجيل الخروج من كل الأجهزة الأخرى")}</button>
        </div>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------ Preferences */
function PreferencesSection() {
  const { prefs, updatePrefs } = useAccount();
  const df = { dateRange: "this_month", clientStatus: "Active", ...(prefs.defaultFilters || {}) };
  const save = async (partial, msg = t("تم حفظ التفضيلات")) => {
    try { await updatePrefs(partial); notifySuccess(msg); } catch (err) { notifyError(err); }
  };

  return (
    <>
      <Section title={t("اللغة")} hint={t("لغة الواجهة. بتتحفظ على حسابك.")}>
        <Segmented value={getLang()} onChange={(language) => save({ language }, t("تم تغيير اللغة"))} options={[["ar", "العربية"], ["en", "English"]]} />
      </Section>

      <Section title={t("المظهر")} hint={t("بيتحفظ على حسابك ويتطبق على أي جهاز تدخل منه.")}>
        <FieldLabel>{t("الوضع")}</FieldLabel>
        <Segmented value={prefs.theme || "dark"} onChange={(theme) => save({ theme })} options={[["dark", t("☾ داكن")], ["light", t("☀ فاتح")]]} />
        <FieldLabel>{t("القائمة الجانبية")}</FieldLabel>
        <Segmented value={prefs.sidebar || "expanded"} onChange={(sidebar) => save({ sidebar })} options={[["expanded", t("موسّعة")], ["collapsed", t("مصغّرة (أيقونات)")]]} />
      </Section>

      <Section title={t("الفلاتر الافتراضية")} hint={t("الفترة وحالة العميل اللي تتفتح بيهم الصفحات، وبترجع ليهم لما تضغط «إعادة تعيين».")}>
        <Row>
          <div>
            <FieldLabel>{t("الفترة الزمنية")}</FieldLabel>
            <select style={inputStyle} value={df.dateRange} onChange={(e) => save({ defaultFilters: { dateRange: e.target.value } })}>
              {DATE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>{t("حالة العميل")}</FieldLabel>
            <select style={inputStyle} value={df.clientStatus} onChange={(e) => save({ defaultFilters: { clientStatus: e.target.value } })}>
              {STATUS_OPTIONS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
          </div>
        </Row>
      </Section>

      <Section title={t("صفحة البداية")} hint={t("الصفحة اللي تفتح بعد تسجيل الدخول.")}>
        <div style={{ maxWidth: 320 }}>
          <select style={inputStyle} value={prefs.startPage || "/dashboard"} onChange={(e) => save({ startPage: e.target.value })}>
            {START_PAGES.map((p) => <option key={p.to} value={p.to}>{p.label}</option>)}
          </select>
        </div>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- Company */
function CompanySection() {
  const { logoUrl, refreshCompany } = useAccount();
  const [c, setC] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyLogo, setBusyLogo] = useState(false);
  const fileRef = useRef(null);

  const load = async () => { try { setC(await api.getCompany()); } catch (err) { notifyError(err); } };
  useEffect(() => { load(); }, []);
  if (!c) return <LoadingBox rows={2} />;
  const set = (k, v) => setC((prev) => ({ ...prev, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: c.name, tagline: c.tagline, email: c.email || "", phone: c.phone || "", address: c.address || "",
        tax_number: c.tax_number || "", default_commission_rate: c.default_commission_rate, invoice_prefix: c.invoice_prefix, invoice_footer: c.invoice_footer || "",
      };
      setC(await api.updateCompany(payload));
      await refreshCompany();
      notifySuccess(t("تم حفظ بيانات الشركة"));
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const pickLogo = async (file) => {
    if (!file) return;
    setBusyLogo(true);
    try {
      await api.uploadCompanyLogo(await fileToDataUrl(file, { maxSide: 600, type: "image/png" }));
      await load(); await refreshCompany();
      notifySuccess(t("تم رفع اللوجو"));
    } catch (err) { notifyError(err); }
    finally { setBusyLogo(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const removeLogo = async () => {
    setBusyLogo(true);
    try { await api.deleteCompanyLogo(); await load(); await refreshCompany(); notifySuccess(t("رجع اللوجو الافتراضي")); }
    catch (err) { notifyError(err); }
    finally { setBusyLogo(false); }
  };

  return (
    <form onSubmit={save}>
      <Section title={t("اللوجو")} hint={t("بيظهر في القائمة الجانبية وفي فواتير الـ PDF. الأفضل PNG بخلفية شفافة. لو مفيش لوجو مرفوع بيتستخدم لوجو TAT الافتراضي.")}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div className="tat-logo-preview">{logoUrl ? <img src={logoUrl} alt="" /> : <img src="/tat-logo-white.png" alt="" />}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickLogo(e.target.files?.[0])} />
            <button type="button" disabled={busyLogo} onClick={() => fileRef.current?.click()} style={btnStyle(GOLD)}>{c.has_logo ? t("تغيير اللوجو") : t("رفع لوجو")}</button>
            {c.has_logo && <button type="button" disabled={busyLogo} onClick={removeLogo} style={{ ...btnStyle("transparent"), color: INK, border: "1px solid var(--border-strong)", boxShadow: "none" }}>{t("استعادة الافتراضي")}</button>}
          </div>
        </div>
      </Section>

      <Section title={t("بيانات الشركة")} hint={t("بتظهر في الفواتير.")}>
        <Row>
          <div><FieldLabel>{t("اسم الشركة")}</FieldLabel><input style={inputStyle} value={c.name || ""} onChange={(e) => set("name", e.target.value)} required /></div>
          <div><FieldLabel>{t("الشعار النصي (Tagline)")}</FieldLabel><input style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={c.tagline || ""} onChange={(e) => set("tagline", e.target.value)} /></div>
          <div><FieldLabel>{t("إيميل الشركة")}</FieldLabel><input type="email" style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={c.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
          <div><FieldLabel>{t("هاتف الشركة")}</FieldLabel><input style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={c.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
          <div><FieldLabel>{t("الرقم الضريبي")}</FieldLabel><input style={{ ...inputStyle, direction: "ltr", textAlign: "right" }} value={c.tax_number || ""} onChange={(e) => set("tax_number", e.target.value)} /></div>
          <div><FieldLabel>{t("العنوان")}</FieldLabel><input style={inputStyle} value={c.address || ""} onChange={(e) => set("address", e.target.value)} /></div>
        </Row>
      </Section>

      <Section
        title={t("الفواتير والعمولة")}
        footer={<button type="submit" disabled={saving} style={{ ...btnStyle(GOLD), opacity: saving ? 0.6 : 1 }}>{saving ? t("جارٍ الحفظ…") : t("حفظ إعدادات الشركة")}</button>}
      >
        <Row>
          <div>
            <FieldLabel>{t("نسبة عمولة الإعلانات الافتراضية (%)")}</FieldLabel>
            <input type="number" min="0" max="100" step="0.5" style={inputStyle} value={c.default_commission_rate ?? 20} onChange={(e) => set("default_commission_rate", e.target.value)} />
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("للعمليات الجديدة فقط — العمليات القديمة بتحتفظ بنسبتها.")}</div>
          </div>
          <div>
            <FieldLabel>{t("بادئة ترقيم الفواتير")}</FieldLabel>
            <input style={{ ...inputStyle, direction: "ltr", textAlign: "right", textTransform: "uppercase" }} maxLength={10} value={c.invoice_prefix || ""} onChange={(e) => set("invoice_prefix", e.target.value)} />
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("للفواتير التلقائية الجديدة، مثال:")}{" "}{(c.invoice_prefix || "INV").toUpperCase()}-0042</div>
          </div>
          <div>
            <FieldLabel>{t("العملة")}</FieldLabel>
            <input style={{ ...inputStyle, opacity: 0.7 }} value={t("EGP — جنيه مصري")} disabled />
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("النظام بيشتغل بعملة واحدة في كل التقارير.")}</div>
          </div>
        </Row>
        <FieldLabel>{t("نص أسفل الفاتورة")}</FieldLabel>
        <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={c.invoice_footer || ""} onChange={(e) => set("invoice_footer", e.target.value)} placeholder={t("مثال: شكرًا لثقتكم — الدفع خلال 7 أيام من تاريخ الإصدار")} />
      </Section>
    </form>
  );
}

/* ------------------------------------------------------------------- Page */
export default function Settings() {
  const { can } = useAccount();
  const isAdmin = can("settings", "view");
  const canEditSettings = can("settings", "edit");
  const [tab, setTab] = useState("profile");
  const TABS = [
    ["profile", t("الملف الشخصي"), "users"],
    ["security", t("الأمان"), "shield"],
    ["prefs", t("التفضيلات"), "sliders"],
    ...(isAdmin ? [["company", t("إعدادات الشركة"), "invoice"], ["email", t("البريد الإلكتروني"), "receipt"], ["webhooks", "Webhooks", "activity"]] : []),
  ];

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{t("الإعدادات")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("حسابك وتفضيلاتك")}{isAdmin ? t(" وبيانات الشركة") : ""}</div>
      </div>
      <div className="tat-settings">
        <nav className="tat-settings-nav" aria-label={t("أقسام الإعدادات")}>
          {TABS.map(([id, label, icon]) => (
            <button key={id} type="button" className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              <Icon name={icon} size={17} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          {tab === "profile" && <ProfileSection />}
          {tab === "security" && <SecuritySection />}
          {tab === "prefs" && <PreferencesSection />}
          {tab === "company" && isAdmin && <CompanySection />}
          {tab === "email" && isAdmin && <EmailSettings scope="agency" canEdit={canEditSettings} />}
          {tab === "webhooks" && isAdmin && <WebhooksSection canEdit={canEditSettings} />}
        </div>
      </div>
    </div>
  );
}
