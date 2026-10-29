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

async function call(cookie, method, path, { body, branch, idempotency } = {}) {
  const headers = { 'content-type': 'application/json', cookie };
  if (branch) headers['x-branch-id'] = branch;
  if (idempotency) headers['idempotency-key'] = `smoke-${Math.random().toString(36).slice(2)}`;
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
// Opening last month's payroll creates it, so B has payroll lines to aim at
const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 7);
const bPayrollItem = (await call(b, 'GET', `/payroll/runs/${lastMonth}`)).json.items[0];

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
  ['URL', "read B's stylist's pay", () => call(a, 'GET', `/payroll/staff/${bStaff._id}`), 404],
  ['URL', "set B's stylist's pay", () => call(a, 'POST', `/payroll/staff/${bStaff._id}/plans`, { body: { model: 'FIXED', monthlyBase: 100, effectiveFrom: tomorrow } }), 404],
  ['URL', "give B's stylist an advance", () => call(a, 'POST', `/payroll/staff/${bStaff._id}/advances`, { body: { amount: 100, monthlyRepayment: 100, method: 'CASH', givenOn: tomorrow.slice(0, 8) + '01', firstMonth: tomorrow.slice(0, 7), reason: 'Spy' }, idempotency: true }), 404],
  ['URL', "pay B's payroll line", () => call(a, 'POST', `/payroll/items/${bPayrollItem._id}/payments`, { body: { amount: 100, method: 'CASH', paidOn: tomorrow.slice(0, 8) + '01' }, idempotency: true }), 404],
  ['URL', "download B's payslip", () => call(a, 'GET', `/payroll/items/${bPayrollItem._id}/payslip`), 404],
  ['Header', "X-Branch-Id = B's branch (monthly payroll)", () => call(a, 'GET', `/payroll/runs/${lastMonth}`, { branch: bBranch._id }), 403],
  ['Header', "X-Branch-Id = B's branch (staff list)", () => call(a, 'GET', '/staff', { branch: bBranch._id }), 403],
  ['Header', "X-Branch-Id = B's branch (dashboard)", () => call(a, 'GET', '/dashboard', { branch: bBranch._id }), 403],
];

// Inventory add-on (only Glamour Studio has it): Desert Rose aims at Glamour's inventory ids,
// and Glamour aims its inventory screens at Desert Rose's branch
const aSku = (await call(a, 'GET', '/inventory/skus')).json.rows[0];
const aOrder = (await call(a, 'GET', '/inventory/purchasing/orders')).json.orders[0];
const aHandout = (await call(a, 'GET', '/inventory/allocations')).json.handouts[0];
attempts.push(
  ['Inventory (B→A)', "B opens A's product", () => call(b, 'GET', `/inventory/skus/${aSku._id}`), 403],
  ['Inventory (B→A)', "B edits A's product", () => call(b, 'PATCH', `/inventory/skus/${aSku._id}`, { body: { version: 1, name: 'Hacked' }, idempotency: true }), 403],
  ['Inventory (B→A)', "B reads A's purchase order", () => call(b, 'GET', `/inventory/purchasing/orders/${aOrder._id}`), 403],
  ['Inventory (B→A)', "B finishes A's hand-out", () => call(b, 'POST', `/inventory/allocations/${aHandout._id}/finish`, { body: { qty: 1 }, idempotency: true }), 403],
  ['Header', "X-Branch-Id = B's branch (inventory overview)", () => call(a, 'GET', '/inventory/overview', { branch: bBranch._id }), 403],
  ['Header', "X-Branch-Id = B's branch (inventory reports)", () => call(a, 'GET', '/inventory/reports/stock-summary', { branch: bBranch._id }), 403]
);

// Billing (bills, payments, refunds, advances, cash days, reports): Glamour aims at Desert Rose's records
const bBill = (await call(b, 'GET', `/invoices/${bPaid.invoiceId}`)).json.invoice;
const bPayment = bBill.payments.find((p) => p.kind === 'PAYMENT');
const bCashDay = (await call(b, 'GET', '/cash-sessions/current')).json.recent[0];
attempts.push(
  ['Billing (URL)', "download B's bill PDF", () => call(a, 'GET', `/invoices/${bBill._id}/pdf`), 404],
  ['Billing (URL)', "read B's bill history", () => call(a, 'GET', `/invoices/${bBill._id}/history`), 404],
  ['Billing (URL)', "make a share link for B's bill", () => call(a, 'POST', `/invoices/${bBill._id}/share`), 404],
  ['Billing (URL)', "void B's bill", () => call(a, 'POST', `/invoices/${bBill._id}/void`, { body: { reason: 'Spy test' }, idempotency: true }), 404],
  ['Billing (URL)', "reverse B's payment", () => call(a, 'POST', `/payments/${bPayment._id}/reverse`, { body: { reason: 'Spy test' }, idempotency: true }), 404],
  ['Billing (URL)', "adjust B's cash day", () => call(a, 'POST', `/cash-sessions/${bCashDay._id}/adjustments`, { body: { amount: 100, reason: 'Spy test' }, idempotency: true }), 404],
  ['Billing (URL)', "read B's customer's money", () => call(a, 'GET', `/customers/${bCustomer._id}/money`), 404],
  ['Billing (Body)', "pay B's bill", () => call(a, 'POST', '/payments', { body: { invoiceId: bBill._id, payments: [{ method: 'CASH', amount: 100 }] }, idempotency: true }), 404],
  ['Billing (Body)', "refund B's bill", () => call(a, 'POST', '/refunds/quote', { body: { invoiceId: bBill._id, lines: [{ lineId: bBill.lines[0]._id, qty: 1 }] } }), 404],
  ['Billing (Body)', "take an advance for B's customer", () => call(a, 'POST', '/advances', { body: { customerId: bCustomer._id, method: 'CASH', amount: 100 }, idempotency: true }), 404],
  ['Billing (Query)', "read B's customer's advances", () => call(a, 'GET', `/advances?customerId=${bCustomer._id}`), 404],
  ['Header', "X-Branch-Id = B's branch (billing reports)", () => call(a, 'GET', '/billing/reports/sales', { branch: bBranch._id }), 403],
  ['Header', "X-Branch-Id = B's branch (cash drawer)", () => call(a, 'GET', '/cash-sessions/current', { branch: bBranch._id }), 403],
  ['Header', "X-Branch-Id = B's branch (new sale)", () => call(a, 'POST', '/invoices/sale', { body: { customerId: null }, branch: bBranch._id }), 403]
);

// Birthday & Anniversary Offers (only Glamour Studio has it on): each salon aims at the other's offers and customers
const aCampaign = (await call(a, 'GET', '/occasions/campaigns')).json.campaigns[0];
const aOffer = (await call(a, 'GET', '/occasions/offers?tab=all&branch=all')).json.offers[0];
attempts.push(
  ['Occasions (B→A)', "B opens A's campaign", () => call(b, 'GET', `/occasions/campaigns/${aCampaign._id}`), 404],
  ['Occasions (B→A)', "B withdraws A's offers", () => call(b, 'POST', `/occasions/campaigns/${aCampaign._id}/revoke`, { body: { year: new Date().getFullYear(), reason: 'Spy test' }, idempotency: true }), 404],
  ['Occasions (B→A)', "B previews A's offer message", () => call(b, 'GET', `/occasions/offers/${aOffer._id}/send-preview`), 404],
  ['Occasions (B→A)', "B records a call on A's offer", () => call(b, 'POST', `/occasions/offers/${aOffer._id}/contact`, { body: { outcome: 'REACHED' }, idempotency: true }), 404],
  ['Occasions (B→A)', "B reads A's customer's offers", () => call(b, 'GET', `/occasions/customers/${aOffer.customerId}/offers`), 404],
  ['Occasions (URL)', "read B's customer's messaging permission", () => call(a, 'GET', `/occasions/customers/${bCustomer._id}/consents`), 404],
  ['Occasions (URL)', "change B's customer's birthday", () => call(a, 'PUT', `/occasions/customers/${bCustomer._id}/dates`, { body: { birthday: { month: 1 } }, idempotency: true }), 404],
  ['Occasions (URL)', "record permission for B's customer", () => call(a, 'POST', `/occasions/customers/${bCustomer._id}/consents`, { body: { channel: 'SMS', status: 'OPTED_OUT', source: 'IN_SALON' }, idempotency: true }), 404],
  ['Header', "X-Branch-Id = B's branch (occasion list)", () => call(a, 'GET', '/occasions/offers', { branch: bBranch._id }), 403],
  ['Header', "X-Branch-Id = B's branch (occasion reports)", () => call(a, 'GET', '/occasions/reports', { branch: bBranch._id }), 403]
);

console.log(`Tenant isolation smoke test against ${API}\nLogged in as Glamour Studio, using Desert Rose's ids (and the other way round for inventory):\n`);
const rows = [];
for (const [where, what, request, expected] of attempts) {
  const { status, json } = await request();
  rows.push({ where, attempt: what, expected, got: status, error: json.error?.code ?? '', result: status === expected ? 'BLOCKED ✅' : 'NOT BLOCKED ❌' });
}
console.table(rows);

const failed = rows.filter((r) => r.got !== r.expected).length;
console.log(failed === 0 ? `All ${rows.length} attempts were blocked.` : `${failed} attempt(s) were NOT blocked!`);
process.exit(failed === 0 ? 0 : 1);
