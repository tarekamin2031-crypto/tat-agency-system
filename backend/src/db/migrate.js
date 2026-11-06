const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
// Schema changes run as one multi-statement transaction, so on Neon use the DIRECT (unpooled) connection
// for migrations (the pooled PgBouncer endpoint is for the app's normal queries).
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
const pool = require("./pool");
const { backfillCollectionEntries } = require("../lib/collectionSync");
const { seedAgencyDefaults } = require("../lib/agencySeed");

async function migrate() {
  const schemaPath = path.join(__dirname, "..", "..", "..", "database", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  console.log("Applying database schema...");
  await pool.query(schema);
  console.log("Schema applied successfully.");

  const adminEmail = process.env.ADMIN_EMAIL || "admin@tatagency.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const adminName = process.env.ADMIN_NAME || "Admin";

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool.query(
      "INSERT INTO users (name, email, password_hash, role, agency_id) VALUES ($1, $2, $3, 'admin', 1)",
      [adminName, adminEmail, hash]
    );
    console.log(`Seeded initial admin user: ${adminEmail}`);
  } else {
    console.log("Admin user already exists, skipping seed.");
  }

  // ---- Multi-agency: default roles for every agency, role assignment for existing users ----
  const agencies = (await pool.query("SELECT id, name FROM agencies ORDER BY id")).rows;
  for (const a of agencies) {
    const roleIds = await seedAgencyDefaults(pool, a.id, { name: a.name });
    await pool.query("UPDATE users SET role_id = $2 WHERE agency_id = $1 AND role_id IS NULL AND role = 'admin'", [a.id, roleIds.agency_admin]);
    await pool.query("UPDATE users SET role_id = $2 WHERE agency_id = $1 AND role_id IS NULL", [a.id, roleIds.member]);
  }
  // The platform owner (Super Admin) is the seeded admin unless PLATFORM_ADMIN_EMAIL says otherwise.
  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL || adminEmail;
  const flagged = await pool.query("UPDATE users SET is_platform_admin = true WHERE email = $1 AND is_platform_admin = false RETURNING email", [platformEmail]);
  if (flagged.rows.length) console.log(`Marked ${platformEmail} as platform admin.`);

  const backfilled = await backfillCollectionEntries(pool);
  console.log(`Collection auto-link backfill: ${backfilled} entr${backfilled === 1 ? "y" : "ies"} created.`);

  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
