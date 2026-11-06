// Roles & permissions. A role's permissions are stored as { module: [actions] }.
// The "agency_admin" role is always treated as having everything, whatever is
// stored, so an agency can never lock itself out.

const MODULES = [
  "dashboard", "clients", "invoices", "expenses", "personal_expenses",
  "collection", "ad_budgets", "services", "reports", "team", "settings", "logs",
];
const ACTIONS = ["view", "create", "edit", "delete", "export"];

const all = () => Object.fromEntries(MODULES.map((m) => [m, [...ACTIONS]]));
const pick = (spec) => {
  const out = {};
  for (const [m, a] of Object.entries(spec)) out[m] = a === "*" ? [...ACTIONS] : a.split(",").filter(Boolean);
  return out;
};

const DEFAULT_ROLES = [
  { key: "agency_admin", name: "مدير الوكالة", description: "كل الصلاحيات، بما فيها الفريق والإعدادات والسجل.", permissions: all() },
  {
    key: "accountant", name: "محاسب", description: "الفواتير والمصاريف والتحصيل والتقارير المالية.",
    permissions: pick({
      dashboard: "view", clients: "view", invoices: "view,create,edit,export", expenses: "view,create,edit,export",
      collection: "view,create,edit", ad_budgets: "view,create,edit", services: "view", reports: "view,export",
    }),
  },
  {
    key: "account_manager", name: "مدير حسابات", description: "العملاء والتحصيل والفواتير بدون المصاريف والتقارير.",
    permissions: pick({
      dashboard: "view", clients: "view,create,edit", invoices: "view,create,edit", collection: "view,create,edit",
      ad_budgets: "view", services: "view",
    }),
  },
  {
    key: "member", name: "عضو", description: "تشغيل كامل للأقسام الأساسية بدون الفريق والإعدادات والسجل والمصاريف الشخصية.",
    permissions: pick({
      dashboard: "*", clients: "*", invoices: "*", expenses: "*", collection: "*", ad_budgets: "*", services: "*", reports: "*",
    }),
  },
  {
    key: "viewer", name: "عرض فقط", description: "يشوف الأقسام الأساسية بدون أي تعديل.",
    permissions: pick({
      dashboard: "view", clients: "view", invoices: "view", collection: "view", ad_budgets: "view", services: "view", reports: "view",
    }),
  },
];

// Keeps only known modules/actions (de-duplicated); anything else is dropped.
function sanitizePermissions(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const m of MODULES) {
    const list = Array.isArray(src[m]) ? src[m].filter((a) => ACTIONS.includes(a)) : [];
    const uniq = [...new Set(list)];
    // view is implied by any other action
    if (uniq.length && !uniq.includes("view")) uniq.unshift("view");
    if (uniq.length) out[m] = uniq;
  }
  return out;
}

function hasPermission(perms, module, action = "view") {
  return !!(perms && Array.isArray(perms[module]) && perms[module].includes(action));
}

// Inserts the default roles for an agency (skips ones that already exist) and
// returns { roleKey: roleId }.
async function seedDefaultRoles(db, agencyId) {
  for (const r of DEFAULT_ROLES) {
    await db.query(
      `INSERT INTO roles (agency_id, key, name, description, is_system, permissions)
       VALUES ($1,$2,$3,$4,true,$5::jsonb) ON CONFLICT (agency_id, key) DO NOTHING`,
      [agencyId, r.key, r.name, r.description, JSON.stringify(r.permissions)]
    );
  }
  const { rows } = await db.query("SELECT id, key FROM roles WHERE agency_id = $1", [agencyId]);
  return Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

module.exports = { MODULES, ACTIONS, DEFAULT_ROLES, all, sanitizePermissions, hasPermission, seedDefaultRoles };
