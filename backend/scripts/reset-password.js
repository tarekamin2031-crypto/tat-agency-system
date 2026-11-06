// Reset one user's password directly in the database (used when a password is forgotten).
//   node scripts/reset-password.js            -> lists the users (email, role) so you can see the exact email
//   node scripts/reset-password.js <email>    -> asks for the new password (hidden) and saves it
// Reads DATABASE_URL_UNPOOLED / DATABASE_URL from the environment or ../.env.local. Never prints secrets.
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const envFile = path.join(__dirname, "..", "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
process.env.DB_SSL = process.env.DB_SSL || "true";

const bcrypt = require("bcryptjs");
const pool = require("../src/db/pool");

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

(async () => {
  const email = (process.argv[2] || "").trim();
  if (!email) {
    const { rows } = await pool.query("SELECT email, role, is_platform_admin FROM users ORDER BY id");
    console.log("Users in the database:");
    rows.forEach((r) => console.log(` - ${r.email}  (${r.role}${r.is_platform_admin ? ", platform admin" : ""})`));
    return pool.end();
  }
  const { rows } = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (!rows.length) { console.log("No user with that email. Run without arguments to list users."); return pool.end(); }
  const pw = await askHidden("New password (min 8 chars, hidden): ");
  if (pw.length < 8) { console.log("Too short, nothing changed."); return pool.end(); }
  const hash = await bcrypt.hash(pw, 10);
  await pool.query("UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1", [rows[0].id, hash]);
  console.log("Password updated. Old sessions were signed out.");
  await pool.end();
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
