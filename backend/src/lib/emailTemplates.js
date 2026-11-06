// Bilingual (ar/en) email templates. Each returns { subject, html, text }.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STR = {
  ar: {
    hello: (n) => `أهلاً ${n}،`,
    regards: "تحياتنا،",
    ignore: "لو ماطلبتش ده، تجاهل الإيميل.",
    welcome: {
      subject: (a) => `تمت دعوتك إلى ${a}`,
      line: (a) => `تمت إضافتك إلى نظام ${a}. اضغط على الزر لتعيين كلمة المرور والدخول.`,
      cta: "تعيين كلمة المرور",
      expires: (h) => `الرابط صالح لمدة ${h} ساعة.`,
    },
    reset: {
      subject: "إعادة تعيين كلمة المرور",
      line: "وصلنا طلب لإعادة تعيين كلمة مرور حسابك.",
      cta: "إعادة تعيين كلمة المرور",
      expires: (h) => `الرابط صالح لمدة ${h} ساعة ويُستخدم مرة واحدة.`,
    },
    reminder: {
      subject: (n, c) => `تذكير بدفع الفاتورة ${n} — ${c}`,
      line: (n, amt, due) => `نذكّركم بالفاتورة ${n}. المبلغ المتبقي: ${amt}${due ? ` — تاريخ الاستحقاق: ${due}` : ""}.`,
      thanks: "شكرًا لتعاونكم، ولو تم السداد يرجى تجاهل هذه الرسالة.",
    },
    payment: {
      subject: (n) => `تم تسجيل دفعة — فاتورة ${n}`,
      line: (n, c, amt) => `تم تسجيل دفعة على الفاتورة ${n} للعميل ${c}: ${amt}.`,
    },
    overdue: {
      subject: (n) => `${n} فاتورة متأخرة جديدة`,
      line: "الفواتير التالية أصبحت متأخرة السداد:",
    },
    lead: { subject: (n) => `طلب تواصل جديد من ${n}`, ackSubject: "وصلتنا رسالتك", ack: "شكرًا لتواصلك! استلمنا رسالتك وفريقنا هيرد عليك في أقرب وقت.", labels: { name: "الاسم", email: "الإيميل", phone: "الهاتف", company: "الشركة", size: "حجم الفريق", interest: "الاهتمام", message: "الرسالة" } },
    test: { subject: "رسالة اختبار", line: "إعدادات البريد تعمل بشكل صحيح ✅" },
  },
  en: {
    hello: (n) => `Hi ${n},`,
    regards: "Best regards,",
    ignore: "If you didn't request this, you can ignore this email.",
    welcome: {
      subject: (a) => `You've been invited to ${a}`,
      line: (a) => `You've been added to ${a}. Click the button to set your password and sign in.`,
      cta: "Set your password",
      expires: (h) => `This link is valid for ${h} hours.`,
    },
    reset: {
      subject: "Reset your password",
      line: "We received a request to reset your account password.",
      cta: "Reset password",
      expires: (h) => `The link is valid for ${h} hours and can be used once.`,
    },
    reminder: {
      subject: (n, c) => `Payment reminder for invoice ${n} — ${c}`,
      line: (n, amt, due) => `This is a reminder about invoice ${n}. Amount remaining: ${amt}${due ? ` — due date: ${due}` : ""}.`,
      thanks: "Thank you — if you've already paid, please ignore this message.",
    },
    payment: {
      subject: (n) => `Payment recorded — invoice ${n}`,
      line: (n, c, amt) => `A payment was recorded on invoice ${n} for ${c}: ${amt}.`,
    },
    overdue: {
      subject: (n) => `${n} new overdue invoice(s)`,
      line: "The following invoices became overdue:",
    },
    lead: { subject: (n) => `New contact request from ${n}`, ackSubject: "We got your message", ack: "Thanks for reaching out! We received your message and our team will get back to you shortly.", labels: { name: "Name", email: "Email", phone: "Phone", company: "Company", size: "Team size", interest: "Interest", message: "Message" } },
    test: { subject: "Test message", line: "Your email settings work correctly ✅" },
  },
};

function layout(lang, brand, bodyHtml) {
  const rtl = lang === "ar";
  return `<!DOCTYPE html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><body style="margin:0;background:#EEF2F4;font-family:Tahoma,Arial,sans-serif;color:#0A1A2E;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #D9E2E6;">
<div style="background:linear-gradient(160deg,#0E4A55,#0A1A2E);padding:18px 24px;color:#fff;font-size:17px;font-weight:700;">${esc(brand)}</div>
<div style="padding:24px;font-size:14.5px;line-height:1.8;text-align:${rtl ? "right" : "left"};">${bodyHtml}</div>
</div></body></html>`;
}

const button = (url, label) =>
  `<p style="margin:22px 0;"><a href="${esc(url)}" style="background:#0F7A4F;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:700;display:inline-block;">${esc(label)}</a></p>
<p style="font-size:12px;color:#6B7F88;word-break:break-all;">${esc(url)}</p>`;

/**
 * @param {string} template welcome | reset | reminder | payment | overdue | test
 * @param {string} lang     ar | en
 * @param {object} v        template variables
 * @param {string} brand    agency / company name shown in the header
 */
function render(template, lang, v = {}, brand = "TAT Agency") {
  const L = STR[lang === "en" ? "en" : "ar"];
  const lg = lang === "en" ? "en" : "ar";
  const name = v.name || "";
  let subject, html, text;

  switch (template) {
    case "welcome": {
      subject = L.welcome.subject(brand);
      html = `<p>${esc(L.hello(name))}</p><p>${esc(L.welcome.line(brand))}</p>${button(v.url, L.welcome.cta)}<p style="font-size:12.5px;color:#6B7F88;">${esc(L.welcome.expires(v.hours || 24))}</p>`;
      text = `${L.hello(name)}\n${L.welcome.line(brand)}\n${v.url}\n${L.welcome.expires(v.hours || 24)}`;
      break;
    }
    case "reset": {
      subject = L.reset.subject;
      html = `<p>${esc(L.hello(name))}</p><p>${esc(L.reset.line)}</p>${button(v.url, L.reset.cta)}<p style="font-size:12.5px;color:#6B7F88;">${esc(L.reset.expires(v.hours || 1))} ${esc(L.ignore)}</p>`;
      text = `${L.hello(name)}\n${L.reset.line}\n${v.url}\n${L.reset.expires(v.hours || 1)} ${L.ignore}`;
      break;
    }
    case "reminder": {
      subject = L.reminder.subject(v.number, brand);
      const line = L.reminder.line(v.number, v.amount, v.due);
      html = `<p>${esc(L.hello(name))}</p><p>${esc(line)}</p><p>${esc(L.reminder.thanks)}</p><p>${esc(L.regards)}<br>${esc(brand)}</p>`;
      text = `${L.hello(name)}\n${line}\n${L.reminder.thanks}\n${L.regards}\n${brand}`;
      break;
    }
    case "payment": {
      subject = L.payment.subject(v.number);
      const line = L.payment.line(v.number, v.client, v.amount);
      html = `<p>${esc(line)}</p>`;
      text = line;
      break;
    }
    case "overdue": {
      const items = v.items || [];
      subject = L.overdue.subject(items.length);
      html = `<p>${esc(L.overdue.line)}</p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      text = `${L.overdue.line}\n${items.map((i) => `- ${i}`).join("\n")}`;
      break;
    }
    case "lead_notice": {
      const lb = L.lead.labels;
      subject = L.lead.subject(v.name);
      const rows = [[lb.name, v.name], [lb.email, v.email], [lb.phone, v.phone], [lb.company, v.company], [lb.size, v.team_size], [lb.interest, v.interest], [lb.message, v.message]].filter(([, x]) => x);
      html = "<table style=\"border-collapse:collapse;width:100%\">" + rows.map(([k, x]) => `<tr><td style="padding:6px 10px;color:#6B7F88;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 10px;white-space:pre-wrap">${esc(x)}</td></tr>`).join("") + "</table>";
      text = rows.map(([k, x]) => `${k}: ${x}`).join("\n");
      break;
    }
    case "lead_ack": {
      subject = L.lead.ackSubject;
      html = `<p>${esc(L.hello(name))}</p><p>${esc(L.lead.ack)}</p><p>${esc(L.regards)}<br>${esc(brand)}</p>`;
      text = `${L.hello(name)}\n${L.lead.ack}\n${L.regards}\n${brand}`;
      break;
    }
    case "test": {
      subject = L.test.subject;
      html = `<p>${esc(L.test.line)}</p>`;
      text = L.test.line;
      break;
    }
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
  return { subject, html: layout(lg, brand, html), text };
}

module.exports = { render };
