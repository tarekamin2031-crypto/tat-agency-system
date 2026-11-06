const test = require("node:test");
const assert = require("node:assert/strict");
const { MODULES, ACTIONS, DEFAULT_ROLES, sanitizePermissions, hasPermission } = require("../src/lib/permissions");

const role = (key) => DEFAULT_ROLES.find((r) => r.key === key).permissions;

test("agency_admin has every action on every module", () => {
  const p = role("agency_admin");
  MODULES.forEach((m) => ACTIONS.forEach((a) => assert.ok(hasPermission(p, m, a), `${m}.${a}`)));
});

test("viewer can only view; cannot create/edit/delete/export anything", () => {
  const p = role("viewer");
  assert.ok(hasPermission(p, "invoices", "view"));
  ["create", "edit", "delete", "export"].forEach((a) => MODULES.forEach((m) => assert.equal(hasPermission(p, m, a), false, `${m}.${a}`)));
  assert.equal(hasPermission(p, "team", "view"), false);
});

test("sensitive modules are admin-only by default (team, settings, logs, personal expenses)", () => {
  ["accountant", "account_manager", "member", "viewer"].forEach((k) => {
    ["team", "settings", "logs", "personal_expenses"].forEach((m) => assert.equal(hasPermission(role(k), m, "view"), false, `${k}:${m}`));
  });
});

test("accountant can manage invoices/expenses but not clients", () => {
  const p = role("accountant");
  assert.ok(hasPermission(p, "invoices", "edit"));
  assert.ok(hasPermission(p, "expenses", "create"));
  assert.equal(hasPermission(p, "clients", "edit"), false);
});

test("sanitizePermissions drops unknown modules/actions, dedupes and implies view", () => {
  const out = sanitizePermissions({ invoices: ["edit", "edit", "hack"], evil: ["view"], clients: "view", team: [] });
  assert.deepEqual(out, { invoices: ["view", "edit"] });
  assert.deepEqual(sanitizePermissions(null), {});
});

test("hasPermission is safe on missing data", () => {
  assert.equal(hasPermission(undefined, "invoices"), false);
  assert.equal(hasPermission({}, "invoices", "view"), false);
});
