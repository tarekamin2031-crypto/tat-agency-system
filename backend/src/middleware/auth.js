const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { all, hasPermission } = require("../lib/permissions");

const DEFAULT_SECRET = "change-this-secret-in-production";
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;

if (process.env.NODE_ENV === "production" && JWT_SECRET === DEFAULT_SECRET) {
  console.error("FATAL: JWT_SECRET must be set in production.");
  process.exit(1);
}

// Loads the signed-in user together with their agency, role and effective
// permissions in one query. Agency admins always get every permission.
async function loadUserContext(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role AS legacy_role, u.is_active, u.token_version, u.agency_id, u.role_id,
            u.is_platform_admin, r.key AS role_key, r.name AS role_name, r.permissions,
            a.name AS agency_name, a.is_active AS agency_active, a.default_language
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN agencies a ON a.id = u.agency_id
      WHERE u.id = $1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return null;
  const isAgencyAdmin = u.role_key === "agency_admin" || (!u.role_id && u.legacy_role === "admin");
  return {
    ...u,
    isAgencyAdmin,
    permissions: isAgencyAdmin ? all() : (u.permissions || {}),
  };
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    // Re-check the DB so a disabled/demoted user loses access immediately
    // instead of keeping a valid 7-day token.
    const u = await loadUserContext(payload.id);
    if (!u || !u.is_active) {
      return res.status(401).json({ error: "Account is disabled" });
    }
    // Tokens issued before a password change / "sign out everywhere" are dead.
    if ((payload.tv ?? 0) !== u.token_version) {
      return res.status(401).json({ error: "Session expired, please sign in again" });
    }
    if (!u.is_platform_admin) {
      if (!u.agency_id) return res.status(403).json({ error: "هذا الحساب غير مرتبط بوكالة" });
      if (!u.agency_active) return res.status(403).json({ error: "الوكالة موقوفة. تواصل مع إدارة المنصة." });
    }
    req.user = {
      id: u.id,
      name: u.name,
      email: u.email,
      // legacy field the frontend still reads: "admin" == agency admin
      role: u.isAgencyAdmin ? "admin" : "member",
      roleKey: u.role_key || (u.isAgencyAdmin ? "agency_admin" : "member"),
      roleName: u.role_name || null,
      agencyId: u.agency_id,
      agencyName: u.agency_name,
      agencyLanguage: u.default_language,
      permissions: u.permissions,
      isAgencyAdmin: u.isAgencyAdmin,
      isPlatformAdmin: u.is_platform_admin,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// Agency admin only (kept for endpoints that are not covered by a module permission).
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAgencyAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

const can = (user, module, action = "view") => !!user && hasPermission(user.permissions, module, action);

function requirePermission(module, action = "view") {
  return (req, res, next) => {
    if (!can(req.user, module, action)) {
      return res.status(403).json({ error: "ليس لديك صلاحية لتنفيذ هذا الإجراء", code: "forbidden", module, action });
    }
    next();
  };
}

// Allows the request when the user holds at least one of [[module, action], …].
function requireAnyPermission(pairs) {
  return (req, res, next) => {
    if (!pairs.some(([m, a]) => can(req.user, m, a || "view"))) {
      return res.status(403).json({ error: "ليس لديك صلاحية لتنفيذ هذا الإجراء", code: "forbidden" });
    }
    next();
  };
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user || !req.user.isPlatformAdmin) {
    return res.status(403).json({ error: "Platform admin access required" });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requirePermission, requireAnyPermission, requirePlatformAdmin, can, loadUserContext, JWT_SECRET };
