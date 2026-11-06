const defaultPool = require("../db/pool");

const PUBLIC_COLUMNS = `name, tagline, email, phone, address, tax_number, default_commission_rate,
  invoice_prefix, invoice_footer, (logo_data IS NOT NULL) AS has_logo, updated_at`;

const FALLBACK = {
  name: "TAT Agency", tagline: "Social Media Agency", email: null, phone: null, address: null, tax_number: null,
  default_commission_rate: 20, invoice_prefix: "INV", invoice_footer: null, has_logo: false,
};

// Company details (never throws — callers like the PDF renderer or the invoice
// job should keep working with sensible defaults if the row/table is missing).
async function getCompany(agencyId, db = defaultPool) {
  try {
    const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM company_settings WHERE agency_id = $1`, [agencyId]);
    return rows[0] ? { ...FALLBACK, ...rows[0] } : { ...FALLBACK };
  } catch (err) {
    console.error("[company] could not read settings:", err.message);
    return { ...FALLBACK };
  }
}

// Custom logo as a data URI for the invoice PDF, or null to use the bundled one.
async function getLogoDataUri(agencyId, db = defaultPool) {
  try {
    const { rows } = await db.query("SELECT logo_data, logo_mime FROM company_settings WHERE agency_id = $1", [agencyId]);
    const r = rows[0];
    if (!r || !r.logo_data) return null;
    return `data:${r.logo_mime || "image/png"};base64,${Buffer.from(r.logo_data).toString("base64")}`;
  } catch {
    return null;
  }
}

module.exports = { getCompany, getLogoDataUri, PUBLIC_COLUMNS };
