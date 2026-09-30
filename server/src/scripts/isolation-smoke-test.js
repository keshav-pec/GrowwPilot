// Tenant isolation smoke test (plan, Phase 15).
// Logs in as Salon B to collect its real ids, then logs in as Salon A and tries to use those ids
// in the URL, in the request body and in the X-Branch-Id header. Every attempt must fail.
//
// Needs a running API with the demo seed:  npm run smoke:isolation
// Against another server:                   API_URL=https://your-app.vercel.app npm run smoke:isolation
import 'dotenv/config';

const API = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
const PASSWORD = 'Password@123';

async function login(email) {
  const res = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`Login failed for ${email} (${res.status}). Is the API running with the demo seed?`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(cookie, method, path, { body, branch } = {}) {
  const headers = { 'content-type': 'application/json', cookie };
  if (branch) headers['x-branch-id'] = branch;
  const res = await fetch(`${API}/api${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

// ----- 1. Salon B (Desert Rose): collect its ids -----
const b = await login('owner@desertrose.com');
const bBranch = (await call(b, 'GET', '/branches')).json.branches[0];
const bStaff = (await call(b, 'GET', '/staff')).json.staff[0];
const bService = (await call(b, 'GET', '/services')).json.services[0];
const bCustomer = (await call(b, 'GET', '/customers')).json.customers[0];
const bLead = (await call(b, 'GET', '/leads')).json.leads[0];
const bAppointments = (await call(b, 'GET', '/appointments')).json.appointments;
const bPaid = bAppointments.find((a) => a.invoiceId);
const bDesk = (await call(b, 'GET', '/users')).json.users.find((u) => u.role === 'FRONT_DESK');

// ----- 2. Salon A (Glamour Studio): its own ids, used alongside B's -----
const a = await login('owner@glamour.com');
const aStaff = (await call(a, 'GET', '/staff')).json.staff[0];
const aService = (await call(a, 'GET', '/services')).json.services.find((s) => s.branchIds.length === 0);
const aCustomer = (await call(a, 'GET', '/customers')).json.customers[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// [where, what we try, request, expected status]
const attempts = [
  ['URL', "read B's branch", () => call(a, 'GET', `/branches/${bBranch._id}`), 404],
  ['URL', "read B's customer", () => call(a, 'GET', `/customers/${bCustomer._id}`), 404],
  ['URL', "read B's appointment", () => call(a, 'GET', `/appointments/${bAppointments[0]._id}`), 404],
  ['URL', "read B's lead", () => call(a, 'GET', `/leads/${bLead._id}`), 404],
  ['URL', "read B's invoice", () => call(a, 'GET', `/invoices/${bPaid.invoiceId}`), 404],
  ['URL', "edit B's stylist", () => call(a, 'PATCH', `/staff/${bStaff._id}`, { body: { name: 'Hacked' } }), 404],
  ['URL', "edit B's service price", () => call(a, 'PATCH', `/services/${bService._id}`, { body: { price: 100 } }), 404],
  ['URL', "cancel B's appointment", () => call(a, 'PATCH', `/appointments/${bAppointments[0]._id}/status`, { body: { status: 'CANCELLED' } }), 404],
  ['URL', "deactivate B's front desk", () => call(a, 'PATCH', `/users/${bDesk._id}/status`, { body: { status: 'inactive' } }), 404],
  ['Body', "book B's customer", () => call(a, 'POST', '/appointments', { body: { customerId: bCustomer._id, date: tomorrow, startTime: '12:00', items: [{ serviceId: aService._id, staffId: aStaff._id }] } }), 404],
  ['Body', "book B's stylist", () => call(a, 'POST', '/appointments', { body: { customerId: aCustomer._id, date: tomorrow, startTime: '12:00', items: [{ serviceId: aService._id, staffId: bStaff._id }] } }), 400],
  ['Body', "book B's service", () => call(a, 'POST', '/appointments', { body: { customerId: aCustomer._id, date: tomorrow, startTime: '12:00', items: [{ serviceId: bService._id, staffId: aStaff._id }] } }), 400],
  ['Body', "check out B's appointment", () => call(a, 'POST', '/invoices', { body: { appointmentId: bPaid._id, payments: [] } }), 404],
  ['Body', 'add a stylist to B’s branch', () => call(a, 'POST', '/staff', { body: { name: 'Spy', role: 'Stylist', branchId: bBranch._id } }), 400],
  ['Body', "offer a service at B's branch", () => call(a, 'POST', '/services', { body: { name: 'Spy', price: 100, branchIds: [bBranch._id] } }), 400],
  ['Body', "assign a lead to B's user", () => call(a, 'POST', '/leads', { body: { name: 'Spy', phone: '9800000000', source: 'Google', assignedToUserId: bDesk._id } }), 400],
  ['Body', "B's stylist as preferred", () => call(a, 'PATCH', `/customers/${aCustomer._id}`, { body: { preferredStaffId: bStaff._id } }), 400],
  ['Query', "analytics for B's branch", () => call(a, 'GET', `/analytics?from=2026-01-01&to=2026-01-31&branchId=${bBranch._id}`), 404],
  ['Header', "X-Branch-Id = B's branch (staff list)", () => call(a, 'GET', '/staff', { branch: bBranch._id }), 403],
  ['Header', "X-Branch-Id = B's branch (dashboard)", () => call(a, 'GET', '/dashboard', { branch: bBranch._id }), 403],
];

console.log(`Tenant isolation smoke test against ${API}\nLogged in as Glamour Studio, using Desert Rose's ids:\n`);
const rows = [];
for (const [where, what, request, expected] of attempts) {
  const { status, json } = await request();
  rows.push({ where, attempt: what, expected, got: status, error: json.error?.code ?? '', result: status === expected ? 'BLOCKED ✅' : 'NOT BLOCKED ❌' });
}
console.table(rows);

const failed = rows.filter((r) => r.got !== r.expected).length;
console.log(failed === 0 ? `All ${rows.length} attempts were blocked.` : `${failed} attempt(s) were NOT blocked!`);
process.exit(failed === 0 ? 0 : 1);
