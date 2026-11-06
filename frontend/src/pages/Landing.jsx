import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Icon from "../components/Icons";
import { t, getLang, setLanguage } from "../i18n";
import "../styles/landing.css";

// Optional public contact details, set at build time (hidden when empty):
//   VITE_CONTACT_EMAIL, VITE_CONTACT_WHATSAPP (digits with country code), VITE_CONTACT_PHONE
const CONTACT = {
  email: import.meta.env.VITE_CONTACT_EMAIL || "tarekamin2031@gmail.com",
  whatsapp: (import.meta.env.VITE_CONTACT_WHATSAPP || "201064000025").replace(/\D/g, ""),
  phone: import.meta.env.VITE_CONTACT_PHONE || "+201064000025",
};

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const els = root.querySelectorAll(".lp-rv");
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return undefined; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return ref;
}

const go = (id) => (e) => { e.preventDefault(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };

function Nav({ open, setOpen }) {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "dark");
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("tat_theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  const link = (id, label) => <a href={`#${id}`} onClick={(e) => { go(id)(e); setOpen(false); }}>{label}</a>;
  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-in">
        <Link to="/welcome" className="lp-logo" aria-label="TAT Agency"><img src="/tat-logo-white.png" alt="TAT Agency" /></Link>
        <nav className={`lp-links${open ? " open" : ""}`} aria-label={t("التنقل")}>
          {link("features", t("المميزات"))}
          {link("how", t("كيف يعمل"))}
          {link("automation", t("الأتمتة"))}
          {link("security", t("الأمان"))}
          {link("faq", t("الأسئلة"))}
          {link("contact", t("تواصل معنا"))}
        </nav>
        <div className="lp-nav-actions">
          <button type="button" className="lp-btn icon" onClick={() => setLanguage(getLang() === "ar" ? "en" : "ar")} aria-label={t("اللغة")} style={{ fontSize: 13 }}>{getLang() === "ar" ? "EN" : "ع"}</button>
          <button type="button" className="lp-btn icon" onClick={toggleTheme} aria-label={t("تبديل الوضع")}><Icon name={theme === "dark" ? "sun" : "moon"} size={18} /></button>
          <Link to="/login" className="lp-btn hide-sm">{t("تسجيل الدخول")}</Link>
          <a href="#contact" onClick={go("contact")} className="lp-btn primary hide-sm">{t("اطلب عرضًا")}</a>
          <button type="button" className="lp-btn icon lp-burger" onClick={() => setOpen(!open)} aria-label={t("فتح القائمة")} aria-expanded={open}><Icon name={open ? "close" : "menu"} size={20} /></button>
        </div>
      </div>
    </header>
  );
}

function HeroMock() {
  const bars = [38, 52, 44, 61, 58, 72, 66, 80, 74, 88, 82, 96];
  return (
    <div style={{ position: "relative" }}>
      <div className="lp-mock" aria-hidden="true">
        <div className="lp-mock-bar"><i /><i /><i /></div>
        <div className="lp-mock-grid">
          <div className="lp-kpi"><small>{t("الإيرادات")}</small><b>62,000</b><span className="up">▲ 8%</span></div>
          <div className="lp-kpi"><small>{t("المحصّل")}</small><b>48,500</b><span className="up">▲ 5%</span></div>
          <div className="lp-kpi"><small>{t("المصاريف")}</small><b>23,500</b><span className="down">▼ 2%</span></div>
          <div className="lp-kpi"><small>{t("صافي الربح")}</small><b style={{ color: "var(--green)" }}>25,000</b><span className="up">▲ 12%</span></div>
          <div className="lp-mock-chart">
            <small>{t("الإيرادات والمحصّل — آخر 12 شهر")}</small>
            <div className="lp-bars">{bars.map((h, i) => <span key={i} className={i % 3 === 1 ? "b" : ""} style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />)}</div>
          </div>
        </div>
        <div className="lp-mock-note">{t("عرض توضيحي ببيانات تجريبية")}</div>
      </div>
      <div className="lp-float f1" aria-hidden="true"><span style={{ color: "var(--green)" }}>✓</span>{t("فاتورة INV-0042 اتسددت")}</div>
      <div className="lp-float f2" aria-hidden="true"><span style={{ color: "var(--teal)" }}>✈</span>{t("إشعار فوري على تليجرام")}</div>
    </div>
  );
}

function ContactForm() {
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", team_size: "", interest: "demo", message: "", website: "" });
  const [state, setState] = useState("idle"); // idle | sending | done
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setState("sending");
    try {
      await api.sendContact({ ...f, lang: getLang() });
      setState("done");
    } catch (err) {
      setError(err.message); setState("idle");
    }
  };

  if (state === "done") {
    return (
      <div className="lp-form lp-ok" role="status">
        <div className="tick">✓</div>
        <h3 style={{ margin: "0 0 6px", fontSize: 22 }}>{t("وصلتنا رسالتك")}</h3>
        <p style={{ color: "var(--ink-2)", lineHeight: 1.8, margin: 0 }}>{t("شكرًا لتواصلك! هنرد عليك في أقرب وقت، وبعتنالك إيميل تأكيد.")}</p>
      </div>
    );
  }

  return (
    <form className="lp-form" onSubmit={submit} noValidate={false}>
      <div className="lp-form-row">
        <div className="lp-field"><label htmlFor="c-name">{t("الاسم")} *</label><input id="c-name" required minLength={2} maxLength={150} value={f.name} onChange={set("name")} autoComplete="name" /></div>
        <div className="lp-field"><label htmlFor="c-email">{t("البريد الإلكتروني")} *</label><input id="c-email" type="email" required maxLength={200} value={f.email} onChange={set("email")} autoComplete="email" style={{ direction: "ltr", textAlign: "start" }} /></div>
      </div>
      <div className="lp-form-row">
        <div className="lp-field"><label htmlFor="c-phone">{t("رقم الهاتف / واتساب")}</label><input id="c-phone" type="tel" maxLength={30} value={f.phone} onChange={set("phone")} autoComplete="tel" style={{ direction: "ltr", textAlign: "start" }} /></div>
        <div className="lp-field"><label htmlFor="c-company">{t("اسم الوكالة / الشركة")}</label><input id="c-company" maxLength={200} value={f.company} onChange={set("company")} autoComplete="organization" /></div>
      </div>
      <div className="lp-form-row">
        <div className="lp-field">
          <label htmlFor="c-size">{t("حجم الفريق")}</label>
          <select id="c-size" value={f.team_size} onChange={set("team_size")}>
            <option value="">{t("اختر")}</option>
            <option value="1-5">{t("1 – 5 أشخاص")}</option>
            <option value="6-15">{t("6 – 15 شخص")}</option>
            <option value="16-50">{t("16 – 50 شخص")}</option>
            <option value="50+">{t("أكتر من 50")}</option>
          </select>
        </div>
        <div className="lp-field">
          <label htmlFor="c-interest">{t("أنا مهتم بـ")}</label>
          <select id="c-interest" value={f.interest} onChange={set("interest")}>
            <option value="demo">{t("عرض تجريبي")}</option>
            <option value="pricing">{t("الأسعار والباقات")}</option>
            <option value="question">{t("عندي سؤال")}</option>
            <option value="partnership">{t("شراكة / تعاون")}</option>
          </select>
        </div>
      </div>
      <div className="lp-field"><label htmlFor="c-msg">{t("رسالتك")}</label><textarea id="c-msg" maxLength={3000} value={f.message} onChange={set("message")} placeholder={t("احكيلنا عن وكالتك وإيه اللي محتاج تنظّمه…")} /></div>
      {/* honeypot — hidden from people, bots fill it */}
      <div className="lp-hp" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label></div>
      {error && <div className="lp-err" role="alert">{error}</div>}
      <button type="submit" className="lp-btn primary lg" disabled={state === "sending"} style={{ width: "100%", opacity: state === "sending" ? 0.7 : 1 }}>
        {state === "sending" ? t("جارٍ الإرسال…") : t("أرسل طلبك")}
      </button>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 12, textAlign: "center" }}>{t("بنستخدم بياناتك للرد عليك فقط، ومش بنشاركها مع أي جهة.")}</div>
    </form>
  );
}

export default function Landing() {
  const [menu, setMenu] = useState(false);
  const rootRef = useReveal();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = t("TAT Agency System — نظام إدارة متكامل لوكالات التسويق");
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "description"; document.head.appendChild(meta); }
    const prevDesc = meta.content;
    meta.content = t("نظام واحد لإدارة العملاء والفواتير والمصاريف والتحصيل والتحليلات المالية لوكالتك — بالعربي والإنجليزي، بصلاحيات وسجل نشاط وأتمتة عبر تليجرام وWebhooks.");
    return () => { document.title = prevTitle; meta.content = prevDesc; };
  }, []);

  const features = [
    ["dashboard", "var(--green)", t("لوحة قيادة تنفيذية"), t("مؤشرات الإيرادات والمحصّل والمصاريف والربح مع مقارنة بالفترة السابقة، وويدجتس تختار منها اللي يهمك، وتصدير التقرير CSV أو PDF.")],
    ["users", "var(--teal)", t("العملاء والعقود"), t("حالة كل عميل ودورة التجديد والخدمات المرتبطة، مع تقييم صحة العميل وربحيته وتنبيهات التجديد.")],
    ["invoice", "var(--green)", t("فواتير ذكية وPDF"), t("فواتير شهرية تلقائية، وPDF بهوية وكالتك وشعارها بالعربي أو الإنجليزي، مع رفع إيصالات الدفع.")],
    ["wallet", "var(--orange)", t("مصاريف الشركة والـ CEO"), t("مصاريف الشركة والرواتب منفصلة عن المصاريف الشخصية للـ CEO، بفئات وفلاتر وسكرين شوت للإيصال.")],
    ["card", "var(--teal)", t("تحصيل ومتابعة"), t("أعمار الديون ومهام التحصيل اليومية والدفعات الجزئية، وتذكير للعميل بالإيميل بضغطة واحدة.")],
    ["megaphone", "var(--green)", t("إعلانات العملاء والعمولة"), t("سجّل ميزانيات الإعلانات اللي بتستلمها من العملاء، وعمولة الوكالة بتتحسب تلقائيًا ضمن الأرباح.")],
    ["trend", "var(--teal)", t("تحليلات مالية متقدمة"), t("ربحية العملاء والخدمات، وتوقعات التدفق النقدي، وتنبيهات ذكية للمتأخرات والعملاء المعرّضين للخسارة.")],
    ["shield", "var(--orange)", t("صلاحيات الأعضاء"), t("أدوار جاهزة (مدير، محاسب، مدير حسابات، عرض فقط) أو أنشئ أدوارك، ومصفوفة صلاحيات لكل قسم.")],
    ["clock", "var(--teal)", t("سجل نشاط كامل"), t("من عمل إيه ومتى، مع القيم قبل وبعد كل تعديل، وتسجيلات الدخول ومحاولات الدخول الفاشلة.")],
    ["table", "var(--green)", t("متعدد الوكالات (SaaS)"), t("كل وكالة بياناتها معزولة تمامًا، ولوحة منصة لإنشاء الوكالات وإيقافها وتحديد عدد مستخدميها.")],
    ["receipt", "var(--orange)", t("إيميل وإشعارات"), t("دعوات الفريق واستعادة كلمة المرور وتذكيرات العملاء، وإشعارات المديرين عند السداد وملخص المتأخرات اليومي.")],
    ["activity", "var(--green)", t("أتمتة وWebhooks"), t("اربط أي حدث بتليجرام أو Zapier أو Make أو n8n، برسائل جاهزة وتوقيع آمن وإعادة محاولة تلقائية.")],
    ["sliders", "var(--teal)", t("عربي وإنجليزي وكل الشاشات"), t("واجهة ثنائية اللغة بالاتجاه الصحيح، وتعمل بسلاسة على الكمبيوتر والتابلت والموبايل، بوضع داكن أو فاتح.")],
  ];

  const faqs = [
    [t("هل بيانات وكالتي معزولة عن الوكالات الأخرى؟"), t("أيوه. كل وكالة لها بياناتها الخاصة ولا يمكن لأي وكالة أخرى قراءتها أو تعديلها، وده متغطّى باختبارات عزل بين الوكالات.")],
    [t("مين يقدر يشوف مصاريف الـ CEO الشخصية؟"), t("بس الأدوار اللي تديها الصلاحية صراحةً. المصاريف الشخصية قسم منفصل مخفي عن باقي الفريق افتراضيًا، حتى من الأرقام الإجمالية.")],
    [t("هل النظام بيدعم العربي والإنجليزي؟"), t("أيوه، الواجهة وفواتير الـ PDF والإيميلات كلها بالعربي والإنجليزي، وكل مستخدم يختار لغته والاتجاه بيتبدّل تلقائيًا.")],
    [t("أقدر أستقبل إشعارات على تليجرام؟"), t("أيوه. من الإعدادات ← Webhooks اختار Telegram وحط Bot Token و Chat ID، واختار الأحداث (فاتورة اتسددت، فاتورة اتأخرت، عميل جديد…) وتوصلك رسالة جاهزة بلغتك.")],
    [t("هل بيشتغل على الموبايل؟"), t("أيوه، التصميم متجاوب بالكامل ويشتغل على الموبايل والتابلت والكمبيوتر من المتصفح بدون تثبيت أي تطبيق.")],
    [t("إزاي أبدأ؟ وكام السعر؟"), t("ابعتلنا طلب من الفورم تحت. هنرتب عرضًا تجريبيًا ونجهّز وكالتك بحساب مدير خاص بيك، ونحدد الباقة المناسبة لحجم فريقك.")],
  ];

  const matrix = [
    [t("مدير الوكالة"), 1, 1, 1, 1],
    [t("محاسب"), 1, 1, 0, 0],
    [t("مدير حسابات"), 1, 0, 0, 0],
    [t("عرض فقط"), 0, 0, 0, 0],
  ];

  return (
    <div className="lp" ref={rootRef}>
      <Nav open={menu} setOpen={setMenu} />

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div>
            <span className="lp-badge"><Icon name="check" size={14} />{t("نظام إدارة متكامل لوكالات التسويق")}</span>
            <h1 className="lp-h1">{t("كل أعمال وكالتك")} <em>{t("في مكان واحد")}</em></h1>
            <p className="lp-sub">{t("عملاء وفواتير ومصاريف وتحصيل وتحليلات مالية — بالعربي والإنجليزي، بصلاحيات وسجل نشاط لكل عضو، وإشعارات مباشرة على تليجرام.")}</p>
            <div className="lp-cta">
              <a href="#contact" onClick={go("contact")} className="lp-btn primary lg">{t("اطلب عرضًا تجريبيًا")}</a>
              <a href="#features" onClick={go("features")} className="lp-btn lg">{t("استكشف المميزات")}</a>
            </div>
            <div className="lp-chips">
              {[t("عربي / English"), t("RTL و LTR"), t("متعدد الوكالات"), t("موبايل وتابلت وكمبيوتر"), t("داكن وفاتح")].map((c) => <span key={c} className="lp-chip"><Icon name="check" size={13} />{c}</span>)}
            </div>
          </div>
          <HeroMock />
        </div>
      </section>

      <section id="features" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head center lp-rv">
            <div className="lp-eyebrow">{t("المميزات")}</div>
            <h2 className="lp-h2">{t("كل اللي وكالتك محتاجاه في نظام واحد")}</h2>
            <p className="lp-lead">{t("من أول عقد العميل لحد آخر جنيه اتحصّل — كل حاجة مترابطة، وأرقام الفلاتر والتقارير بتتطابق في كل مكان.")}</p>
          </div>
          <div className="lp-features">
            {features.map(([icon, color, title, body], i) => (
              <article key={title} className="lp-card lp-rv" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
                <div className="lp-ico" style={{ "--c": color }}><Icon name={icon} size={22} /></div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="lp-sec alt">
        <div className="lp-wrap">
          <div className="lp-head center lp-rv">
            <div className="lp-eyebrow">{t("كيف يعمل")}</div>
            <h2 className="lp-h2">{t("جاهز للشغل في 3 خطوات")}</h2>
          </div>
          <div className="lp-steps">
            {[
              [t("اطلب عرضًا"), t("املا الفورم ونتواصل معاك لنفهم شغل وكالتك وفريقك.")],
              [t("نجهّز وكالتك"), t("بننشئ حساب وكالتك ومديرها، وبتضبط شعارك وخدماتك وأدوار فريقك.")],
              [t("ابدأ الشغل"), t("ضيف عملاءك وفواتيرك، وادعُ فريقك بالإيميل، وتابع أرقامك لحظة بلحظة.")],
            ].map(([h, p]) => <div key={h} className="lp-step lp-rv"><h3>{h}</h3><p>{p}</p></div>)}
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap lp-split">
          <div className="lp-rv">
            <div className="lp-eyebrow">{t("التحصيل")}</div>
            <h2 className="lp-h2">{t("حصّل فلوسك أسرع وبدون ما حد يفوتك")}</h2>
            <p className="lp-lead">{t("النظام بيربط الفواتير بالتحصيل تلقائيًا، فكل فاتورة متأخرة بتظهر في مهام اليوم مع أولوية واضحة.")}</p>
            <ul className="lp-list">
              {[t("أعمار الديون: 0–30 / 31–60 / 61–90 / +90 يوم"), t("دفعات جزئية بتتحدّث في الفاتورة والتحصيل مع بعض"), t("تذكير بالدفع للعميل بالإيميل بضغطة واحدة"), t("توقعات التدفق النقدي لشهر و3 و6 شهور")].map((x) => <li key={x}><Icon name="check" size={18} /><span>{x}</span></li>)}
            </ul>
          </div>
          <div className="lp-panel lp-rv">
            <table className="lp-matrix">
              <thead><tr><th>{t("الفئة العمرية")}</th><th>{t("إجمالي المتأخر")}</th><th>{t("عدد العملاء")}</th></tr></thead>
              <tbody>
                {[["0–30", "18,400", 3], ["31–60", "9,250", 2], ["61–90", "4,100", 1], ["90+", "2,600", 1]].map(([a, b, c]) => <tr key={a}><td>{a} {t("يوم")}</td><td className="tat-code" style={{ fontFamily: "var(--font-mono)" }}>{b} EGP</td><td>{c}</td></tr>)}
              </tbody>
            </table>
            <div className="lp-mock-note">{t("عرض توضيحي ببيانات تجريبية")}</div>
          </div>
        </div>
      </section>

      <section id="automation" className="lp-sec alt">
        <div className="lp-wrap lp-split flip">
          <div className="lp-panel lp-rv">
            <div className="lp-chat">
              <div className="lp-chat-head"><i>✈</i><span>{t("إشعارات الوكالة")}</span></div>
              <div className="lp-bubble">{t("✅ فاتورة INV-0042 اتسددت — Acme — 1,500 EGP")}</div>
              <div className="lp-bubble">{t("⏰ فاتورة INV-0038 متأخرة 2 يوم — Nova Studio")}</div>
              <div className="lp-bubble">{t("🔄 تجديد قريب: Delta Foods بعد 5 يوم")}</div>
            </div>
            <div className="lp-mock-note">{t("عرض توضيحي")}</div>
          </div>
          <div className="lp-rv">
            <div className="lp-eyebrow">{t("الأتمتة")}</div>
            <h2 className="lp-h2">{t("خلّي النظام يكلّمك — على تليجرام وأي أداة")}</h2>
            <p className="lp-lead">{t("Webhooks بطريقتي GET وPOST. اختار الأحداث، واكتب نص الرسالة بنفسك أو استخدم رسائل جاهزة بالعربي والإنجليزي.")}</p>
            <ul className="lp-list">
              {[t("إعداد جاهز لتليجرام: Bot Token وChat ID وخلاص"), t("توقيع HMAC آمن وإعادة محاولة تلقائية وسجل تسليم"), t("زر اختبار فوري ومفتاح سري تقدر تجدده")].map((x) => <li key={x}><Icon name="check" size={18} /><span>{x}</span></li>)}
            </ul>
            <div className="lp-tags">{["Telegram", "Zapier", "Make", "n8n", "Webhook"].map((x) => <span key={x} className="lp-tag">{x}</span>)}</div>
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap lp-split">
          <div className="lp-rv">
            <div className="lp-eyebrow">{t("الصلاحيات")}</div>
            <h2 className="lp-h2">{t("كل عضو يشوف اللي يخصه بس")}</h2>
            <p className="lp-lead">{t("أدوار جاهزة وأدوار مخصصة، وصلاحية لكل قسم (عرض، إضافة، تعديل، حذف، تصدير). ومصاريف الـ CEO الشخصية مخفية عن الكل إلا لو سمحت.")}</p>
            <ul className="lp-list">
              {[t("سجل نشاط بكل عملية: من، ومتى، وإيه اللي اتغيّر"), t("دعوة الأعضاء بالإيميل — كل واحد يحدد كلمة مروره"), t("إيقاف أي حساب فورًا")].map((x) => <li key={x}><Icon name="check" size={18} /><span>{x}</span></li>)}
            </ul>
          </div>
          <div className="lp-panel lp-rv">
            <table className="lp-matrix">
              <thead><tr><th>{t("الدور")}</th><th>{t("الفواتير")}</th><th>{t("المصاريف")}</th><th>{t("الفريق")}</th><th>{t("سجل النشاط")}</th></tr></thead>
              <tbody>{matrix.map(([role, ...cells]) => <tr key={role}><td>{role}</td>{cells.map((c, i) => <td key={i} className={c ? "lp-yes" : "lp-no"}>{c ? "✓" : "—"}</td>)}</tr>)}</tbody>
            </table>
            <div className="lp-mock-note">{t("مثال لمصفوفة الصلاحيات — تقدر تعدّلها بالكامل")}</div>
          </div>
        </div>
      </section>

      <section id="security" className="lp-sec alt">
        <div className="lp-wrap">
          <div className="lp-head center lp-rv">
            <div className="lp-eyebrow">{t("الأمان")}</div>
            <h2 className="lp-h2">{t("بياناتك المالية في أمان")}</h2>
          </div>
          <div className="lp-sec-grid">
            {[
              [t("عزل كامل بين الوكالات"), t("كل استعلام مقيّد بوكالتك، ومغطّى باختبارات عزل.")],
              [t("كلمات مرور مشفّرة"), t("كلمات المرور مُجزّأة بـ bcrypt، وكلمات SMTP مشفّرة بـ AES-256.")],
              [t("جلسات تحت سيطرتك"), t("تغيير كلمة المرور أو «خروج من كل الأجهزة» بيقفل أي جلسة قديمة فورًا.")],
              [t("حماية من التخمين"), t("حد لمحاولات الدخول والتواصل لمنع الهجمات الآلية.")],
              [t("Webhooks موقّعة"), t("كل طلب موقّع بـ HMAC، والروابط الداخلية محجوبة.")],
              [t("سجل نشاط محفوظ"), t("كل عملية بتتسجل بالمستخدم والوقت والقيم قبل وبعد، وتقدر تراجعها في أي وقت.")],
            ].map(([h, p]) => <div key={h} className="lp-sec-item lp-rv"><Icon name="shield" size={22} /><div><b>{h}</b><span>{p}</span></div></div>)}
          </div>
        </div>
      </section>

      <section id="faq" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head center lp-rv">
            <div className="lp-eyebrow">{t("الأسئلة")}</div>
            <h2 className="lp-h2">{t("أسئلة شائعة")}</h2>
          </div>
          <div className="lp-faq lp-rv">
            {faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </div>
      </section>

      <section id="contact" className="lp-sec alt">
        <div className="lp-wrap lp-contact">
          <div className="lp-rv">
            <div className="lp-eyebrow">{t("تواصل معنا")}</div>
            <h2 className="lp-h2">{t("خلّينا نجهّز لك عرضًا تجريبيًا")}</h2>
            <p className="lp-lead">{t("سيب بياناتك وهنتواصل معاك، أو كلّمنا مباشرة.")}</p>
            <div className="lp-info">
              {CONTACT.email && <a href={`mailto:${CONTACT.email}`}><Icon name="receipt" size={20} /><span style={{ direction: "ltr" }}>{CONTACT.email}</span></a>}
              {CONTACT.whatsapp && <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer"><Icon name="card" size={20} /><span>WhatsApp</span></a>}
              {CONTACT.phone && <a href={`tel:${CONTACT.phone}`}><Icon name="activity" size={20} /><span style={{ direction: "ltr" }}>{CONTACT.phone}</span></a>}
              <Link to="/login"><Icon name="users" size={20} /><span>{t("عندك حساب؟ سجّل دخولك")}</span></Link>
            </div>
          </div>
          <div className="lp-rv"><ContactForm /></div>
        </div>
      </section>

      <div className="lp-wrap">
        <div className="lp-final lp-rv">
          <h2>{t("جاهز تنظّم وكالتك؟")}</h2>
          <p>{t("ابدأ بعرض تجريبي وشوف النظام على بيانات تشبه شغلك.")}</p>
          <a href="#contact" onClick={go("contact")} className="lp-btn primary lg">{t("اطلب عرضًا تجريبيًا")}</a>
        </div>
        <footer className="lp-foot">
          <div className="lp-foot-in">
            <span>© {new Date().getFullYear()} TAT Agency System. {t("جميع الحقوق محفوظة.")}</span>
            <div className="lp-foot-links">
              <a href="#features" onClick={go("features")}>{t("المميزات")}</a>
              <a href="#security" onClick={go("security")}>{t("الأمان")}</a>
              <a href="#faq" onClick={go("faq")}>{t("الأسئلة")}</a>
              <a href="#contact" onClick={go("contact")}>{t("تواصل معنا")}</a>
              <Link to="/login">{t("تسجيل الدخول")}</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
