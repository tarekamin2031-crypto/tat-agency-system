const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { requireAuth, requirePermission, loadUserContext, JWT_SECRET } = require("../middleware/auth");

const { createRateLimiter } = require("../middleware/security");
const { sanitizePreferences, validateNewPassword, parseImageUpload, validateEmail } = require("../lib/settingsValidation");
const { audit } = require("../lib/audit");
const { sendEmail } = require("../lib/mailer");
const { getCompany } = require("../lib/company");
const { randomToken, sha256 } = require("../lib/secrets");

const RESET_HOURS = 1;
const INVITE_HOURS = 24;
const appUrl = (req) => (process.env.APP_URL || req.headers.origin || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

// Creates a one-time link for a user and returns the plain token (only its hash is stored).
async function createResetToken(userId, hours) {
  const token = randomToken(32);
  await pool.query("DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL", [userId]);
  await pool.query("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' hours')::interval)", [userId, sha256(token), String(hours)]);
  return token;
}

async function emailLinkTo(req, user, template, hours) {
  const token = await createResetToken(user.id, hours);
  const company = await getCompany(user.agency_id);
  const lang = (user.preferences && user.preferences.language) || user.default_language || "ar";
  return sendEmail({
    agencyId: user.agency_id, to: user.email, template, lang, brand: company.name,
    vars: { name: user.name, url: `${appUrl(req)}/reset-password?token=${token}`, hours },
  });
}

const router = express.Router();
const loginLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60 * 1000 });
const MIN_PASSWORD_LENGTH = 8;
const sensitiveLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
const AVATAR_MAX_BYTES = 400 * 1024;

// Tokens carry the user's token_version: bumping it (password change, "sign out
// everywhere") invalidates every older token at once.
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, tv: user.token_version || 0 },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

const PROFILE_COLUMNS = "id, name, email, role, phone, preferences, (avatar_data IS NOT NULL) AS has_avatar, last_login_at, prev_login_at, password_changed_at, created_at";

// What the frontend needs to know about the signed-in user: identity, role,
// effective permissions and the agency they belong to.
function sessionFields(ctx) {
  return {
    role: ctx.isAgencyAdmin ? "admin" : "member", // legacy flag the UI still reads
    roleKey: ctx.role_key || (ctx.isAgencyAdmin ? "agency_admin" : "member"),
    roleName: ctx.role_name || null,
    permissions: ctx.permissions,
    isAgencyAdmin: ctx.isAgencyAdmin,
    isPlatformAdmin: !!ctx.is_platform_admin,
    agency: ctx.agency_id ? { id: ctx.agency_id, name: ctx.agency_name, default_language: ctx.default_language } : null,
  };
}

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE lower(email) = lower($1)", [String(email)]);
    const user = result.rows[0];
    if (!user || user.is_active === false) {
      audit(req, { action: "auth.login_failed", user: { email: String(email).slice(0, 150) }, agencyId: user ? user.agency_id : null, summary: user ? "account disabled" : "unknown email" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      audit(req, { action: "auth.login_failed", user: { id: user.id, name: user.name, email: user.email }, agencyId: user.agency_id, summary: "wrong password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ctx = await loadUserContext(user.id);
    if (!ctx.is_platform_admin) {
      if (!ctx.agency_id) return res.status(403).json({ error: "هذا الحساب غير مرتبط بوكالة" });
      if (!ctx.agency_active) {
        audit(req, { action: "auth.login_failed", user: { id: user.id, name: user.name, email: user.email }, agencyId: user.agency_id, summary: "agency suspended" });
        return res.status(403).json({ error: "الوكالة موقوفة. تواصل مع إدارة المنصة." });
      }
    }

    await pool.query("UPDATE users SET prev_login_at = last_login_at, last_login_at = now() WHERE id = $1", [user.id]);
    const token = signToken(user);
    audit(req, { action: "auth.login", entity: "user", entityId: user.id, user: { id: user.id, name: user.name, email: user.email }, agencyId: user.agency_id });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, preferences: user.preferences || {}, ...sessionFields(ctx) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// POST /api/auth/forgot-password { email } — always answers ok (never reveals which emails exist)
router.post("/forgot-password", loginLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || "").trim();
  try {
    if (email) {
      const r = await pool.query(
        `SELECT u.*, a.default_language FROM users u LEFT JOIN agencies a ON a.id = u.agency_id
          WHERE lower(u.email) = lower($1) AND u.is_active`, [email]);
      const user = r.rows[0];
      if (user) {
        await emailLinkTo(req, user, "reset", RESET_HOURS);
        audit(req, { action: "auth.password_reset_request", entity: "user", entityId: user.id, user: { id: user.id, name: user.name, email: user.email }, agencyId: user.agency_id });
      }
    }
  } catch (err) {
    console.error("[forgot-password]", err.message);
  }
  res.json({ ok: true });
});

// POST /api/auth/reset-password { token, new_password } — also used by invite links
router.post("/reset-password", sensitiveLimiter, async (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token) return res.status(400).json({ error: "الرابط غير صالح أو انتهت صلاحيته" });
  try {
    const r = await pool.query(
      "SELECT pr.id, pr.user_id FROM password_resets pr WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()",
      [sha256(token)]
    );
    const pr = r.rows[0];
    if (!pr) return res.status(400).json({ error: "الرابط غير صالح أو انتهت صلاحيته" });
    const problem = validateNewPassword(new_password, "");
    if (problem) return res.status(400).json({ error: problem });
    const hash = await bcrypt.hash(String(new_password), 10);
    const upd = await pool.query(
      "UPDATE users SET password_hash = $1, password_changed_at = now(), token_version = token_version + 1 WHERE id = $2 AND is_active RETURNING id, name, email, agency_id",
      [hash, pr.user_id]
    );
    if (!upd.rows[0]) return res.status(400).json({ error: "الرابط غير صالح أو انتهت صلاحيته" });
    await pool.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [pr.id]);
    const u = upd.rows[0];
    audit(req, { action: "auth.password_reset", entity: "user", entityId: u.id, user: { id: u.id, name: u.name, email: u.email }, agencyId: u.agency_id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error resetting password" });
  }
});

// POST /api/auth/logout — the token itself is stateless; this just records the event.
router.post("/logout", requireAuth, async (req, res) => {
  audit(req, { action: "auth.logout", entity: "user", entityId: req.user.id });
  res.json({ ok: true });
});

// GET /api/auth/me — full profile of the signed-in user
router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`, [req.user.id]);
  const ctx = await loadUserContext(req.user.id);
  res.json({ user: { ...rows[0], ...sessionFields(ctx) } });
});

// PATCH /api/auth/me — name / phone / email (changing the email needs the current password)
router.patch("/me", requireAuth, sensitiveLimiter, async (req, res) => {
  const { name, phone, email, current_password } = req.body;
  try {
    const sets = [];
    const vals = [];
    const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    if (name !== undefined) {
      const n = String(name).trim();
      if (!n) return res.status(400).json({ error: "الاسم مطلوب" });
      add("name", n.slice(0, 150));
    }
    if (phone !== undefined) add("phone", String(phone).trim().slice(0, 50) || null);

    if (email !== undefined && String(email).trim().toLowerCase() !== req.user.email.toLowerCase()) {
      const e = String(email).trim();
      if (!validateEmail(e)) return res.status(400).json({ error: "الإيميل غير صالح" });
      const cur = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
      if (!current_password || !(await bcrypt.compare(String(current_password), cur.rows[0].password_hash))) {
        return res.status(403).json({ error: "اكتب كلمة المرور الحالية عشان تغيّر الإيميل" });
      }
      add("email", e);
    }
    if (!sets.length) return res.status(400).json({ error: "مفيش حاجة تتعدّل" });

    const beforeRes = await pool.query("SELECT name, email, phone FROM users WHERE id = $1", [req.user.id]);
    vals.push(req.user.id);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    const { rows } = await pool.query(`SELECT ${PROFILE_COLUMNS}, token_version FROM users WHERE id = $1`, [req.user.id]);
    const u = rows[0];
    audit(req, {
      action: "profile.update", entity: "user", entityId: req.user.id,
      before: beforeRes.rows[0], after: { name: u.name, email: u.email, phone: u.phone }, summary: "own profile",
    });
    // Name/email are embedded in the token, so hand back a fresh one.
    const { token_version, ...publicUser } = u;
    const ctx = await loadUserContext(req.user.id);
    res.json({ user: { ...publicUser, ...sessionFields(ctx) }, token: signToken(u) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "الإيميل ده مستخدم قبل كده" });
    console.error(err);
    res.status(500).json({ error: "Server error updating profile" });
  }
});

// PUT /api/auth/me/preferences — theme, sidebar, default filters, start page, language
router.put("/me/preferences", requireAuth, async (req, res) => {
  const prefs = sanitizePreferences(req.body && req.body.preferences);
  const { rows } = await pool.query(
    "UPDATE users SET preferences = preferences || $1::jsonb WHERE id = $2 RETURNING preferences",
    [JSON.stringify(prefs), req.user.id]
  );
  res.json({ preferences: rows[0].preferences });
});

// POST /api/auth/me/password — change own password (needs the current one)
router.post("/me/password", requireAuth, sensitiveLimiter, async (req, res) => {
  const { current_password, new_password } = req.body;
  try {
    const cur = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = cur.rows[0];
    if (!current_password || !(await bcrypt.compare(String(current_password), user.password_hash))) {
      return res.status(403).json({ error: "كلمة المرور الحالية غلط" });
    }
    const problem = validateNewPassword(new_password, current_password);
    if (problem) return res.status(400).json({ error: problem });

    const hash = await bcrypt.hash(String(new_password), 10);
    const upd = await pool.query(
      "UPDATE users SET password_hash = $1, password_changed_at = now(), token_version = token_version + 1 WHERE id = $2 RETURNING *",
      [hash, req.user.id]
    );
    audit(req, { action: "auth.password_change", entity: "user", entityId: req.user.id });
    // Every other device is signed out; this session continues with a new token.
    res.json({ ok: true, token: signToken(upd.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error changing password" });
  }
});

// POST /api/auth/me/logout-all — sign out every other device
router.post("/me/logout-all", requireAuth, async (req, res) => {
  const upd = await pool.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING *", [req.user.id]);
  audit(req, { action: "auth.logout_all", entity: "user", entityId: req.user.id });
  res.json({ ok: true, token: signToken(upd.rows[0]) });
});

// Avatar: stored in the DB (so it's in the regular backups), served with auth.
router.post("/me/avatar", requireAuth, async (req, res) => {
  const parsed = parseImageUpload(req.body && req.body.data, AVATAR_MAX_BYTES);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  await pool.query("UPDATE users SET avatar_data = $1, avatar_mime = $2 WHERE id = $3", [parsed.buffer, parsed.mime, req.user.id]);
  res.json({ ok: true });
});
router.delete("/me/avatar", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET avatar_data = NULL, avatar_mime = NULL WHERE id = $1", [req.user.id]);
  res.status(204).send();
});
router.get("/me/avatar", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT avatar_data, avatar_mime FROM users WHERE id = $1", [req.user.id]);
  if (!rows[0] || !rows[0].avatar_data) return res.status(404).json({ error: "No avatar" });
  res.set("Content-Type", rows[0].avatar_mime || "image/png");
  res.set("Cache-Control", "private, max-age=60");
  res.send(rows[0].avatar_data);
});

// ---------------------------------------------------------------------------
// Team management (permission: team.*). Everything is scoped to the caller's agency.
// ---------------------------------------------------------------------------

const USER_LIST_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.last_login_at, u.role_id,
         r.key AS role_key, r.name AS role_name
    FROM users u LEFT JOIN roles r ON r.id = u.role_id`;

// Resolve the role to assign: an explicit role_id (must belong to the agency) or the
// legacy "admin"/"member" flag the old UI sends.
async function resolveRole(agencyId, { role_id, role }) {
  if (role_id !== undefined && role_id !== null && role_id !== "") {
    const { rows } = await pool.query("SELECT id, key FROM roles WHERE id = $1 AND agency_id = $2", [Number(role_id), agencyId]);
    return rows[0] || null;
  }
  const key = role === "admin" ? "agency_admin" : "member";
  const { rows } = await pool.query("SELECT id, key FROM roles WHERE agency_id = $1 AND key = $2", [agencyId, key]);
  return rows[0] || null;
}

async function activeUserCount(agencyId) {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE agency_id = $1 AND is_active", [agencyId]);
  return rows[0].n;
}
async function userLimit(agencyId) {
  const { rows } = await pool.query("SELECT max_users FROM agencies WHERE id = $1", [agencyId]);
  return rows[0] ? rows[0].max_users : 0;
}

// POST /api/auth/users  (add a team member)
router.post("/users", requireAuth, requirePermission("team", "create"), async (req, res) => {
  const { name, email } = req.body;
  const invite = !!req.body.send_invite;
  // With an invite the user sets their own password, so we store a random one meanwhile.
  const password = req.body.password || (invite ? randomToken(16) : "");
  const agencyId = req.user.agencyId;
  if (!agencyId) return res.status(400).json({ error: "No agency" });
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }
  if (!validateEmail(String(email).trim())) return res.status(400).json({ error: "الإيميل غير صالح" });
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} حروف على الأقل` });
  }
  try {
    const role = await resolveRole(agencyId, req.body);
    if (!role) return res.status(400).json({ error: "الدور غير صالح" });
    // Only an agency admin can hand out the admin role.
    if (role.key === "agency_admin" && !req.user.isAgencyAdmin) {
      return res.status(403).json({ error: "فقط مدير الوكالة يقدر يضيف مدير" });
    }
    if ((await activeUserCount(agencyId)) >= (await userLimit(agencyId))) {
      return res.status(403).json({ error: "وصلت للحد الأقصى لعدد المستخدمين في باقتك", code: "user_limit" });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, role_id, agency_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [String(name).trim(), String(email).trim(), hash, role.key === "agency_admin" ? "admin" : "member", role.id, agencyId]
    );
    const created = (await pool.query(`${USER_LIST_SQL} WHERE u.id = $1`, [result.rows[0].id])).rows[0];
    audit(req, { action: "user.create", entity: "user", entityId: created.id, after: { name: created.name, email: created.email, role: created.role_key }, summary: created.email });
    let invite_sent = null;
    if (invite) {
      const full = (await pool.query("SELECT u.*, a.default_language FROM users u LEFT JOIN agencies a ON a.id = u.agency_id WHERE u.id = $1", [created.id])).rows[0];
      const r = await emailLinkTo(req, full, "welcome", INVITE_HOURS);
      invite_sent = !!r.ok;
    }
    res.status(201).json({ ...created, invite_sent });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Email already exists" });
    console.error(err);
    res.status(500).json({ error: "Server error creating user" });
  }
});

// GET /api/auth/users (list team members)
router.get("/users", requireAuth, requirePermission("team", "view"), async (req, res) => {
  const result = await pool.query(`${USER_LIST_SQL} WHERE u.agency_id = $1 ORDER BY u.created_at ASC`, [req.user.agencyId]);
  res.json(result.rows);
});

// PATCH /api/auth/users/:id (edit name / role / password, or enable / disable)
router.patch("/users/:id", requireAuth, requirePermission("team", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, password, is_active } = req.body;
  const agencyId = req.user.agencyId;
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid user id" });
  if (password !== undefined && String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} حروف على الأقل` });
  }

  try {
    const targetRes = await pool.query(`${USER_LIST_SQL} WHERE u.id = $1 AND u.agency_id = $2`, [id, agencyId]);
    const target = targetRes.rows[0];
    if (!target) return res.status(404).json({ error: "User not found" });

    const roleChange = req.body.role_id !== undefined || req.body.role !== undefined;
    let newRole = null;
    if (roleChange) {
      newRole = await resolveRole(agencyId, req.body);
      if (!newRole) return res.status(400).json({ error: "الدور غير صالح" });
    }

    // Protect the admin role: only admins can touch an admin or grant the role.
    const touchesAdmin = target.role_key === "agency_admin" || (newRole && newRole.key === "agency_admin");
    if (touchesAdmin && !req.user.isAgencyAdmin) {
      return res.status(403).json({ error: "فقط مدير الوكالة يقدر يعدّل المديرين" });
    }
    const demoting = newRole && newRole.key !== "agency_admin";
    if (id === req.user.id && (demoting || is_active === false)) {
      return res.status(400).json({ error: "مينفعش تعطّل أو تنزّل صلاحية حسابك أنت" });
    }
    if (is_active === true && target.is_active === false) {
      if ((await activeUserCount(agencyId)) >= (await userLimit(agencyId))) {
        return res.status(403).json({ error: "وصلت للحد الأقصى لعدد المستخدمين في باقتك", code: "user_limit" });
      }
    }

    const sets = [];
    const vals = [];
    const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (name !== undefined) add("name", String(name).trim());
    if (newRole) {
      add("role_id", newRole.id);
      add("role", newRole.key === "agency_admin" ? "admin" : "member");
      sets.push("token_version = token_version + 1"); // permissions changed: force a fresh session
    }
    if (is_active !== undefined) add("is_active", Boolean(is_active));
    if (password !== undefined) {
      add("password_hash", await bcrypt.hash(password, 10));
      sets.push("token_version = token_version + 1", "password_changed_at = now()"); // sign the user out everywhere
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });

    vals.push(id, agencyId);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND agency_id = $${vals.length}`, vals);
    const updated = (await pool.query(`${USER_LIST_SQL} WHERE u.id = $1`, [id])).rows[0];

    const snap = (u) => ({ name: u.name, role: u.role_key, is_active: u.is_active });
    audit(req, { action: "user.update", entity: "user", entityId: id, before: snap(target), after: snap(updated), summary: target.email });
    if (password !== undefined) audit(req, { action: "user.password_reset", entity: "user", entityId: id, summary: target.email });
    if (newRole && target.role_id !== newRole.id) {
      audit(req, { action: "permission.role_assigned", entity: "user", entityId: id, before: { role: target.role_key }, after: { role: updated.role_key }, summary: target.email });
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating user" });
  }
});

module.exports = router;
