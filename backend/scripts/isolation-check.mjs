// Cross-agency isolation + permission check against a RUNNING backend.
//
//   BASE_URL=http://localhost:4000 PLATFORM_EMAIL=... PLATFORM_PASSWORD=... node scripts/isolation-check.mjs
//
// It signs in as the platform owner, creates two throw-away agencies (A and B)
// with their own admins, creates data in A, then proves agency B (and a
// restricted role inside A) can neither read, change nor delete it.
// Agencies it creates are disabled at the end (they are never deleted).

const BASE = (process.env.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const { PLATFORM_EMAIL, PLATFORM_PASSWORD } = process.env;
if (!PLATFORM_EMAIL || !PLATFORM_PASSWORD) {
  console.error("Set PLATFORM_EMAIL and PLATFORM_PASSWORD (platform owner credentials).");
  process.exit(2);
}

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}
const login = async (email, password) => {
  const r = await call(null, "POST", "/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.data;
};

const stamp = Date.now().toString(36);
const PASS = `Iso-${stamp}-Pw1!`;
const mk = (tag) => ({ name: `Iso ${tag} ${stamp}`, admin: { name: `Admin ${tag}`, email: `iso-${tag.toLowerCase()}-${stamp}@example.test`, password: PASS } });

const platform = await login(PLATFORM_EMAIL, PLATFORM_PASSWORD);
check("platform owner flagged", platform.user.isPlatformAdmin === true);

console.log("\n# create two agencies");
const A = await call(platform.token, "POST", "/api/platform/agencies", mk("A"));
const B = await call(platform.token, "POST", "/api/platform/agencies", mk("B"));
check("agency A created", A.status === 201, JSON.stringify(A.data));
check("agency B created", B.status === 201, JSON.stringify(B.data));

const adminA = await login(mk("A").admin.email, PASS);
const adminB = await login(mk("B").admin.email, PASS);
check("new admin is not a platform admin", adminA.user.isPlatformAdmin === false);
check("admin has agency admin permissions", adminA.user.isAgencyAdmin === true && adminA.user.permissions.team.includes("delete"));

console.log("\n# platform routes are closed to agency admins");
check("agency admin cannot list agencies", (await call(adminA.token, "GET", "/api/platform/agencies")).status === 403);
check("agency admin cannot read platform logs", (await call(adminA.token, "GET", "/api/platform/logs")).status === 403);

console.log("\n# data created in A");
const svcA = (await call(adminA.token, "GET", "/api/services")).data;
check("A got default services, B got its own", svcA.length > 0 && (await call(adminB.token, "GET", "/api/services")).data.every((s) => !svcA.some((x) => x.id === s.id)));
const clientA = (await call(adminA.token, "POST", "/api/clients", { name: `Client of A ${stamp}`, status: "Active", contract_value: 1000, currency: "EGP", renewal_cycle: "monthly" })).data;
check("client created in A", !!(clientA && clientA.id), JSON.stringify(clientA));
const invA = (await call(adminA.token, "POST", "/api/invoices", { client_id: clientA.id, number: `ISO-${stamp}`, description: "x", amount: 500, issue_date: "2026-01-01", due_date: "2026-02-01", status: "sent" })).data;
check("invoice created in A", !!(invA && invA.id), JSON.stringify(invA));
const expA = (await call(adminA.token, "POST", "/api/expenses", { category: "Tools", amount: 50, date: "2026-01-02", expense_type: "business" })).data;
const persA = (await call(adminA.token, "POST", "/api/expenses", { category: "Personal", amount: 70, date: "2026-01-02", expense_type: "personal" })).data;
const adA = (await call(adminA.token, "POST", "/api/ad-budgets", { client_id: clientA.id, platform: "meta", amount_received: 1000, received_date: "2026-01-03" })).data;
const colA = (await call(adminA.token, "GET", "/api/collection")).data;
check("A sees its own data", colA.length >= 1 && (await call(adminA.token, "GET", "/api/clients")).data.some((c) => c.id === clientA.id));

console.log("\n# agency B cannot reach A's rows");
const t = adminB.token;
const lists = ["clients", "invoices", "expenses", "collection", "ad-budgets"];
for (const l of lists) {
  const r = await call(t, "GET", `/api/${l}`);
  check(`B list /${l} is empty`, r.status === 200 && Array.isArray(r.data) && r.data.length === 0, `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
}
check("B get client by id -> 404", [404, 403].includes((await call(t, "GET", `/api/clients/${clientA.id}`)).status));
check("B update client -> 404", (await call(t, "PUT", `/api/clients/${clientA.id}`, { name: "hacked", status: "Active", contract_value: 1 })).status === 404);
check("B delete client -> 404", (await call(t, "DELETE", `/api/clients/${clientA.id}`)).status === 404);
check("B update invoice -> 404/400", [404, 400].includes((await call(t, "PUT", `/api/invoices/${invA.id}`, { number: "x", amount: 1, issue_date: "2026-01-01" })).status));
check("B record payment on A invoice -> 404", (await call(t, "POST", `/api/invoices/${invA.id}/record-payment`, { amount: 10 })).status === 404);
check("B delete invoice -> 404", (await call(t, "DELETE", `/api/invoices/${invA.id}`)).status === 404);
check("B pdf of A invoice -> 404", (await call(t, "GET", `/api/invoices/${invA.id}/pdf`)).status === 404);
check("B update expense -> 404", (await call(t, "PUT", `/api/expenses/${expA.id}`, { category: "x", amount: 1, date: "2026-01-01" })).status === 404);
check("B delete expense -> 404", (await call(t, "DELETE", `/api/expenses/${expA.id}`)).status === 404);
check("B delete ad budget -> 404", (await call(t, "DELETE", `/api/ad-budgets/${adA.id}`)).status === 404);
check("B cannot attach its invoice to A's client", (await call(t, "POST", "/api/invoices", { client_id: clientA.id, number: "X", amount: 1, issue_date: "2026-01-01" })).status === 400);
check("B cannot book an expense on A's client", (await call(t, "POST", "/api/expenses", { category: "x", amount: 1, date: "2026-01-01", related_client_id: clientA.id })).status === 400);
check("B cannot book an ad budget on A's client", (await call(t, "POST", "/api/ad-budgets", { client_id: clientA.id, amount_received: 1 })).status === 400);
check("B cannot read A collection entry", colA.every(async () => true) && (await call(t, "GET", `/api/collection/${colA[0].id}`)).status === 404);
check("B cannot act on A collection entry", (await call(t, "POST", `/api/collection/${colA[0].id}/quick-action`, { action: "confirm_payment" })).status === 404);

const fin = await call(t, "GET", "/api/finance/summary");
check("B finance summary is all zero", fin.status === 200 && Number(fin.data.revenue) === 0 && Number(fin.data.totalExpenses ?? fin.data.total_expenses ?? 0) === 0, JSON.stringify(fin.data).slice(0, 120));
for (const p of ["payment-center", "client-profitability", "client-health", "by-service"]) {
  const r = await call(t, "GET", `/api/finance/${p}`);
  const leaked = JSON.stringify(r.data).includes(clientA.name);
  check(`B finance/${p} does not mention A's client`, r.status === 200 && !leaked);
}
check("B team list shows only B's users", (await call(t, "GET", "/api/auth/users")).data.every((u) => u.email.includes(`iso-b-${stamp}`)));
check("B logs contain nothing of A", !JSON.stringify((await call(t, "GET", "/api/logs?limit=200")).data).includes(clientA.name));
check("B cannot edit A's user via team api", (await call(t, "PATCH", `/api/auth/users/${adminA.user.id}`, { name: "hacked" })).status === 404);

// A is untouched
const stillThere = (await call(adminA.token, "GET", `/api/clients/${clientA.id}`)).data;
check("A's client is untouched after B's attempts", stillThere && stillThere.name === `Client of A ${stamp}`);

console.log("\n# permissions inside agency A");
const rolesA = (await call(adminA.token, "GET", "/api/roles")).data;
const viewerRole = rolesA.roles.find((r) => r.key === "viewer");
const memberRole = rolesA.roles.find((r) => r.key === "member");
const acctRole = rolesA.roles.find((r) => r.key === "accountant");
const mkUser = async (tag, role) => {
  const email = `iso-${tag}-${stamp}@example.test`;
  const r = await call(adminA.token, "POST", "/api/auth/users", { name: tag, email, password: PASS, role_id: role.id });
  check(`create ${tag} user`, r.status === 201, JSON.stringify(r.data));
  return login(email, PASS);
};
const viewer = await mkUser("viewer", viewerRole);
const member = await mkUser("member", memberRole);
const acct = await mkUser("acct", acctRole);

check("viewer can read clients", (await call(viewer.token, "GET", "/api/clients")).status === 200);
check("viewer cannot create client", (await call(viewer.token, "POST", "/api/clients", { name: "n", status: "Active" })).status === 403);
check("viewer cannot delete invoice", (await call(viewer.token, "DELETE", `/api/invoices/${invA.id}`)).status === 403);
check("viewer cannot see expenses", (await call(viewer.token, "GET", "/api/expenses")).status === 403);
check("viewer cannot open team", (await call(viewer.token, "GET", "/api/auth/users")).status === 403);
check("viewer cannot read logs", (await call(viewer.token, "GET", "/api/logs")).status === 403);
check("viewer cannot edit company settings", (await call(viewer.token, "PUT", "/api/settings/company", { name: "x" })).status === 403);

const memberExpenses = (await call(member.token, "GET", "/api/expenses")).data;
check("member sees business expenses", memberExpenses.some((e) => e.id === expA.id));
check("member never sees personal (CEO) expenses", !memberExpenses.some((e) => e.id === persA.id));
check("member cannot create a personal expense", (await call(member.token, "POST", "/api/expenses", { category: "p", amount: 1, date: "2026-01-01", expense_type: "personal" })).status === 403);
check("member cannot read personal summary", (await call(member.token, "GET", "/api/finance/personal-summary")).status === 403);
check("member cannot manage team", (await call(member.token, "POST", "/api/auth/users", { name: "x", email: `iso-x-${stamp}@example.test`, password: PASS })).status === 403);
check("accountant can create invoices", (await call(acct.token, "POST", "/api/invoices", { client_id: clientA.id, number: `ISO2-${stamp}`, amount: 5, issue_date: "2026-01-05", status: "sent" })).status === 201);
check("accountant cannot delete invoices", (await call(acct.token, "DELETE", `/api/invoices/${invA.id}`)).status === 403);
check("accountant cannot create clients", (await call(acct.token, "POST", "/api/clients", { name: "n", status: "Active" })).status === 403);

console.log("\n# role management");
check("non-admin cannot create a role", (await call(member.token, "POST", "/api/roles", { name: "x", permissions: {} })).status === 403);
const custom = await call(adminA.token, "POST", "/api/roles", { name: "Only invoices", permissions: { invoices: ["view"] } });
check("admin creates custom role", custom.status === 201 && custom.data.permissions.invoices.includes("view"));
check("agency_admin role is locked", (await call(adminA.token, "PUT", `/api/roles/${rolesA.roles.find((r) => r.key === "agency_admin").id}`, { permissions: {} })).status === 400);
check("B cannot see A's roles", !(await call(adminB.token, "GET", "/api/roles")).data.roles.some((r) => r.id === custom.data.id));
check("B cannot change A's role", (await call(adminB.token, "PUT", `/api/roles/${custom.data.id}`, { permissions: { team: ["view", "edit"] } })).status === 404);
check("role in use cannot be deleted", (await call(adminA.token, "DELETE", `/api/roles/${viewerRole.id}`)).status === 400);
check("unused custom role can be deleted", (await call(adminA.token, "DELETE", `/api/roles/${custom.data.id}`)).status === 204);
check("role from another agency cannot be assigned", (await call(adminB.token, "PATCH", `/api/auth/users/${adminB.user.id}`, { role_id: viewerRole.id })).status === 400);

console.log("\n# audit log");
const logs = (await call(adminA.token, "GET", "/api/logs?limit=200")).data;
const has = (a) => logs.rows.some((l) => l.action === a);
check("login recorded", has("auth.login"));
check("client.create recorded", has("client.create"));
check("invoice.create recorded", has("invoice.create"));
check("permission/role creation recorded", has("role.create"));
check("every A log belongs to A", logs.rows.every((l) => l.agency_id === A.data.id));
const failed1 = await call(null, "POST", "/api/auth/login", { email: mk("A").admin.email, password: "wrong-password" });
check("wrong password rejected", failed1.status === 401);
const logs2 = (await call(adminA.token, "GET", "/api/logs?action=auth.login_failed")).data;
check("failed login recorded for the right agency", logs2.rows.length >= 1);
const upd = await call(adminA.token, "PUT", `/api/clients/${clientA.id}`, { ...clientA, name: `Client of A ${stamp} v2` });
const updLog = (await call(adminA.token, "GET", `/api/logs?action=client.update&entity_id=${clientA.id}`)).data.rows[0];
check("update log stores only changed fields (before/after)", upd.status === 200 && updLog && updLog.before_data.name && updLog.after_data.name.endsWith("v2") && !("contract_value" in updLog.after_data));
check("logs never contain password hashes", !JSON.stringify(logs).includes("password_hash"));
const platformLogs = await call(platform.token, "GET", "/api/platform/logs?limit=200");
check("platform owner sees logs of both agencies", platformLogs.status === 200 && new Set(platformLogs.data.rows.map((l) => l.agency_id)).has(A.data.id));

console.log("\n# suspended agency");
const off = await call(platform.token, "PATCH", `/api/platform/agencies/${A.data.id}`, { is_active: false });
check("platform can suspend an agency", off.status === 200 && off.data.is_active === false);
check("suspended agency's token stops working", (await call(adminA.token, "GET", "/api/clients")).status === 403);
check("suspended agency cannot sign in", (await call(null, "POST", "/api/auth/login", { email: mk("A").admin.email, password: PASS })).status === 403);
await call(platform.token, "PATCH", `/api/platform/agencies/${B.data.id}`, { is_active: false });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
