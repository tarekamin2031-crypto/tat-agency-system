const pool = require("../db/pool");
const { validateEmail } = require("./settingsValidation");
const { sendEmail } = require("./mailer");

const TEAM_SIZES = ["1-5", "6-15", "16-50", "50+"];
const INTERESTS = ["demo", "pricing", "question", "partnership"];
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n);

/** Validates the public contact form. Returns { value } or { error } (Arabic, translated by the client). */
function validateLead(body = {}) {
  const name = clip(body.name, 150);
  const email = clip(body.email, 200);
  const phone = clip(body.phone, 50);
  const message = clip(body.message, 3000);
  if (name.length < 2) return { error: "اكتب اسمك" };
  if (!validateEmail(email)) return { error: "الإيميل غير صالح" };
  if (phone && !/^[0-9+()\-\s]{6,30}$/.test(phone)) return { error: "رقم الهاتف غير صالح" };
  if (!message && !phone) return { error: "اكتب رسالتك أو رقم هاتف نتواصل معاك عليه" };
  return {
    value: {
      name, email, phone: phone || null, company: clip(body.company, 200) || null,
      team_size: TEAM_SIZES.includes(body.team_size) ? body.team_size : null,
      interest: INTERESTS.includes(body.interest) ? body.interest : "demo",
      message: message || null, lang: body.lang === "en" ? "en" : "ar",
    },
  };
}

async function saveLead(v, req, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO leads (name, email, phone, company, team_size, interest, message, lang, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [v.name, v.email, v.phone, v.company, v.team_size, v.interest, v.message, v.lang, req.ip || null, String(req.headers["user-agent"] || "").slice(0, 300)]
  );
  return rows[0].id;
}

// Tell the owner(s) and thank the visitor. Never throws; the lead is already saved.
async function notifyLead(v, db = pool) {
  try {
    const owners = (await db.query("SELECT DISTINCT email FROM users WHERE is_platform_admin AND is_active")).rows.map((r) => r.email);
    if (process.env.CONTACT_NOTIFY_EMAIL) owners.push(...process.env.CONTACT_NOTIFY_EMAIL.split(",").map((s) => s.trim()).filter(Boolean));
    for (const to of [...new Set(owners)]) {
      await sendEmail({ agencyId: null, to, template: "lead_notice", lang: "ar", brand: "TAT Platform", vars: v });
    }
    await sendEmail({ agencyId: null, to: v.email, template: "lead_ack", lang: v.lang, brand: "TAT Agency System", vars: { name: v.name } });
  } catch (err) {
    console.error("[leads] notify failed:", err.message);
  }
}

module.exports = { validateLead, saveLead, notifyLead, TEAM_SIZES, INTERESTS };
