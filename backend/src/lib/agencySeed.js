const { seedDefaultRoles } = require("./permissions");

const DEFAULT_SERVICES = [
  "إدارة سوشيال ميديا", "إعلانات ميتا (فيسبوك/انستجرام)", "إعلانات جوجل", "إنشاء محتوى", "تصميم جرافيك",
  "إنتاج فيديو", "استشارات تسويقية", "إعلانات سناب شات", "إعلانات تيك توك", "إعلانات لينكدإن", "إعلانات منصة إكس",
];

// Everything a brand-new agency needs to be usable: company settings row,
// the default services and the default roles. Safe to call repeatedly.
async function seedAgencyDefaults(db, agencyId, { name } = {}) {
  await db.query(
    "INSERT INTO company_settings (agency_id, name) SELECT $1::int, $2::varchar WHERE NOT EXISTS (SELECT 1 FROM company_settings WHERE agency_id = $1::int)",
    [agencyId, name || "Agency"]
  );
  for (const s of DEFAULT_SERVICES) {
    await db.query(
      "INSERT INTO services (agency_id, name) SELECT $1::int, $2::varchar WHERE NOT EXISTS (SELECT 1 FROM services WHERE agency_id = $1::int AND name = $2::varchar)",
      [agencyId, s]
    );
  }
  return seedDefaultRoles(db, agencyId);
}

module.exports = { seedAgencyDefaults, DEFAULT_SERVICES };
