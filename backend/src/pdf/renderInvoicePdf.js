// puppeteer-core is ESM-only: load it lazily with import() so older Node versions (Vercel) can still start the app.
const { buildInvoiceHtml } = require("./invoiceTemplate");
const { getCompany, getLogoDataUri } = require("../lib/company");

const CHROMIUM_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/usr/bin/chromium-browser";

/**
 * Renders an invoice to a PDF buffer via headless Chromium.
 * @param {object} invoice - invoices table row (client_name join optional)
 * @param {object|null} client - clients table row
 * @param {number} agencyId - whose company details/logo to print
 * @param {string} [lang] - "ar" (default) or "en"
 * @returns {Promise<Buffer>}
 */
async function renderInvoicePdf(invoice, client, agencyId, lang = "ar") {
  // Company name / contact / footer / custom logo come from Settings → Company.
  const [company, logoDataUri] = await Promise.all([getCompany(agencyId), getLogoDataUri(agencyId)]);
  const html = buildInvoiceHtml(invoice, client, { company, logoDataUri, lang });

  let launchOptions = { executablePath: CHROMIUM_PATH, args: ["--no-sandbox", "--disable-setuid-sandbox"] };
  if (process.env.VERCEL) {
    // Vercel has no system Chromium: use the serverless build (fonts are embedded in the invoice HTML).
    const chromium = (await import("@sparticuz/chromium")).default; // ESM-only package
    launchOptions = { executablePath: await chromium.executablePath(), args: chromium.args, headless: "shell" };
  }
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    // page.pdf() can return a Uint8Array depending on puppeteer version —
    // coerce to a real Node Buffer so Express sends raw binary, not JSON.
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

module.exports = { renderInvoicePdf };
