const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "assets");

function loadFontBase64(filename) {
  return fs.readFileSync(path.join(ASSETS_DIR, filename)).toString("base64");
}

// The actual TAT Agency logo, embedded as base64 so PDFs never depend on
// an external image URL or a file that might move.
const LOGO_BASE64 = fs.readFileSync(path.join(ASSETS_DIR, "tat-logo-white.png")).toString("base64");

// Fonts are embedded as base64 so PDF generation never depends on internet
// access or on whatever fonts happen to be installed in the container.
const FONT_AR_400 = loadFontBase64("tajawal-arabic-400-normal.woff2");
const FONT_AR_700 = loadFontBase64("tajawal-arabic-700-normal.woff2");
const FONT_LATIN_400 = loadFontBase64("tajawal-latin-400-normal.woff2");
const FONT_LATIN_700 = loadFontBase64("tajawal-latin-700-normal.woff2");

const NAVY = "#0A1A2E";
const GOLD = "#0F7A4F";
const TEAL = "#0E6B73";
const CREAM = "#F1F5F6";

const STATUS_LABELS = {
  ar: { draft: "مسودة", sent: "مرسلة", paid: "مدفوعة", overdue: "متأخرة" },
  en: { draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue" },
};

const TEXT = {
  ar: {
    invoice: "فاتورة", to: "إلى", issueDate: "تاريخ الإصدار", dueDate: "تاريخ الاستحقاق", description: "الوصف", amount: "المبلغ",
    total: "الإجمالي", status: "الحالة", taxNumber: "الرقم الضريبي", unknownClient: "عميل غير محدد",
    defaultDescription: "خدمات إدارة سوشيال ميديا",
    defaultFooter: (name) => `شركة ${name} — هذه فاتورة رسمية صادرة إلكترونياً`,
  },
  en: {
    invoice: "Invoice", to: "Bill to", issueDate: "Issue date", dueDate: "Due date", description: "Description", amount: "Amount",
    total: "Total", status: "Status", taxNumber: "Tax number", unknownClient: "Unspecified client",
    defaultDescription: "Social media management services",
    defaultFooter: (name) => `${name} — this is an official electronically issued invoice`,
  },
};

const MONTHS = {
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};


function formatDateLocal(value, lang = "ar") {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d)) return "—";
  const months = MONTHS[lang] || MONTHS.ar;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  return `${n.toLocaleString("en-US")} ${currency || ""}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Builds a fully self-contained HTML document (fonts embedded as base64)
 * ready to be rendered by a headless browser into a PDF.
 *
 * @param {object} invoice - row from the `invoices` table (client_name optional join)
 * @param {object} client - row from the `clients` table (may be null)
 * @param {object} [options] - { logoDataUri?: string } to embed a real logo image
 */
function buildInvoiceHtml(invoice, client, options = {}) {
  const lang = options.lang === "en" ? "en" : "ar";
  const L = TEXT[lang];
  const rtl = lang === "ar";
  // start/end sides of the page flip with the language
  const START = rtl ? "right" : "left";
  const END = rtl ? "left" : "right";
  const statusLabel = STATUS_LABELS[lang][invoice.status] || invoice.status;
  const clientName = escapeHtml(client?.name || invoice.client_name || L.unknownClient);
  const description = escapeHtml(invoice.description || L.defaultDescription);
  const company = options.company || {};
  const companyName = escapeHtml(company.name || "TAT Agency");
  const tagline = escapeHtml(company.tagline || "Social Media Agency");
  const contactLine = [company.email, company.phone, company.address].filter(Boolean).map(escapeHtml).join(" · ");
  const taxLine = company.tax_number ? `${L.taxNumber}: ${escapeHtml(company.tax_number)}` : "";
  const footerText = escapeHtml(company.invoice_footer || L.defaultFooter(company.name || "TAT Agency"));
  const logoBlock = options.logoDataUri
    ? `<img src="${options.logoDataUri}" alt="${companyName}" style="height:44px; max-width:200px; object-fit:contain;" />`
    : `<div style="background: radial-gradient(circle at 0% 80%, rgba(15,122,79,.8), transparent 60%), radial-gradient(circle at 100% 80%, rgba(26,47,107,.9), transparent 60%), linear-gradient(160deg,#0E4A55,#0A1A2E); border-radius:10px; padding:10px 16px; display:inline-block;"><img src="data:image/png;base64,${LOGO_BASE64}" alt="TAT Agency" style="height:44px; display:block;" /></div>`;

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="UTF-8" />
<style>
  @font-face {
    font-family: 'Tajawal';
    font-weight: 400;
    src: url(data:font/woff2;base64,${FONT_AR_400}) format('woff2');
  }
  @font-face {
    font-family: 'Tajawal';
    font-weight: 700;
    src: url(data:font/woff2;base64,${FONT_AR_700}) format('woff2');
  }
  @font-face {
    font-family: 'Tajawal';
    font-weight: 400;
    src: url(data:font/woff2;base64,${FONT_LATIN_400}) format('woff2');
  }
  @font-face {
    font-family: 'Tajawal';
    font-weight: 700;
    src: url(data:font/woff2;base64,${FONT_LATIN_700}) format('woff2');
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Tajawal', sans-serif;
    color: ${NAVY};
    background: #fff;
  }
  .page { padding: 44px 56px; position: relative; }
  .brand-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 10px;
    background: linear-gradient(90deg, #0F7A4F, #0E4A55 50%, #1A2F6B);
  }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 3px solid ${GOLD}; padding-bottom: 20px; margin-bottom: 32px;
  }
  .logo-text { font-size: 26px; font-weight: 700; }
  .company-sub { font-size: 12.5px; color: #51646C; margin-top: 4px; }
  .invoice-title { font-size: 20px; font-weight: 700; color: ${NAVY}; text-align: ${END}; }
  .invoice-number { font-size: 13px; color: #51646C; text-align: ${END}; margin-top: 2px; }
  .meta-grid { display: flex; justify-content: space-between; margin-bottom: 28px; }
  .meta-label { font-size: 11px; color: #6B7F88; margin-bottom: 4px; }
  .meta-value { font-size: 15px; font-weight: 700; }
  .meta-right { text-align: ${END}; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead tr { background: ${NAVY}; color: #fff; }
  th { text-align: ${START}; padding: 10px 14px; font-size: 12.5px; font-weight: 700; }
  th.amount, td.amount { text-align: ${END}; }
  td { padding: 14px; font-size: 13.5px; border-bottom: 1px solid #DCE5E8; }
  tfoot td { font-weight: 700; font-size: 15px; padding-top: 16px; border-bottom: none; }
  tfoot td.amount { color: ${GOLD}; }
  .status-badge {
    display: inline-block; font-size: 12px; padding: 5px 16px; border-radius: 20px;
    background: ${TEAL}22; color: ${TEAL}; margin-bottom: 30px;
  }
  .footer {
    margin-top: 50px; padding-top: 14px; border-top: 1px solid #DCE5E8;
    font-size: 10.5px; color: #6B7F88; text-align: center;
  }
</style>
</head>
<body>
  <div class="page"><div class="brand-bar"></div>
    <div class="header">
      <div>
        ${logoBlock}
        <div class="company-sub">${companyName}</div>
        ${contactLine ? `<div class="company-sub" style="font-size:11px;">${contactLine}</div>` : ""}
        ${taxLine ? `<div class="company-sub" style="font-size:11px;">${taxLine}</div>` : ""}
      </div>
      <div>
        <div class="invoice-title">${L.invoice}</div>
        <div class="invoice-number">${escapeHtml(invoice.number)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div>
        <div class="meta-label">${L.to}</div>
        <div class="meta-value">${clientName}</div>
      </div>
      <div class="meta-right">
        <div><strong>${L.issueDate}:</strong> ${formatDateLocal(invoice.issue_date, lang)}</div>
        ${invoice.due_date ? `<div><strong>${L.dueDate}:</strong> ${formatDateLocal(invoice.due_date, lang)}</div>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr><th>${L.description}</th><th class="amount">${L.amount}</th></tr>
      </thead>
      <tbody>
        <tr><td>${description}</td><td class="amount">${formatMoney(invoice.amount, invoice.currency)}</td></tr>
      </tbody>
      <tfoot>
        <tr><td>${L.total}</td><td class="amount">${formatMoney(invoice.amount, invoice.currency)}</td></tr>
      </tfoot>
    </table>

    <div class="status-badge">${L.status}: ${escapeHtml(statusLabel)}</div>

    <div class="footer">${footerText}<div style="direction:ltr; letter-spacing:0.4em; font-size:9px; margin-top:6px; color:#9CA3AF; text-transform:uppercase;">${tagline}</div></div>
  </div>
</body>
</html>`;
}

module.exports = { buildInvoiceHtml };
