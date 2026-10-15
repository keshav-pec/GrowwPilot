// Inventory add-on, Phase 1: the Super Admin switch, inventory logins and the permissions table.
// Tested through the real API (login cookie, roles, branch header), like frontDeskAccess.test.js.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { can } from '../src/modules/inventory/permissions.js';
import { getBranchSettings } from '../src/modules/inventory/settings/settings.service.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';

let server;
let api; // base URL
let f;
let glamourId;
const cookies = {};

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], json: await res.json() };
}

async function call(who, method, path, { body, branch } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who] };
  if (branch) headers['x-branch-id'] = String(branch);
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const setInventory = (who, enabled) => call(who, 'PATCH', `/admin/orgs/${glamourId}/addons/inventory`, { body: { enabled } });

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  glamourId = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { role: 'SUPER_ADMIN', name: 'Admin', email: 'admin@gp.com', passwordHash, orgId: null },
    { orgId: glamourId, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: glamourId, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: glamourId, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    // Made directly in the database: owners can't create one while the add-on is off
    { orgId: glamourId, role: 'INVENTORY', name: 'Suresh', email: 'suresh@g.com', passwordHash, branchIds: [f.andheri._id] },
  ]);

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ admin: 'admin@gp.com', business: 'anita@g.com', bandraOwner: 'vikram@g.com', desk: 'kavya@g.com' })) {
    cookies[who] = (await login(email)).cookie;
  }
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('Add-on off (the starting point for every salon)', () => {
  it('closes every inventory API with ADDON_DISABLED', async () => {
    for (const who of ['business', 'bandraOwner', 'desk']) {
      const res = await call(who, 'GET', '/inventory/access');
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('ADDON_DISABLED');
    }
  });

  it('does not let an inventory login sign in', async () => {
    const res = await login('suresh@g.com');
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('ADDON_DISABLED');
  });

  it('does not let an owner create an inventory login', async () => {
    const res = await call('business', 'POST', '/users', { body: { role: 'INVENTORY', name: 'Store Man', email: 'store@g.com', branchIds: [String(f.andheri._id)] } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('ADDON_DISABLED');
  });

  it('tells the screens which add-ons are on', async () => {
    const me = await call('business', 'GET', '/auth/me');
    expect(me.json.user.org.addons).toEqual([]);
  });
});

describe('Super Admin switch', () => {
  it('only the Super Admin can use it', async () => {
    expect((await setInventory('business', true)).status).toBe(403);
  });

  it('refuses add-ons that do not exist', async () => {
    const res = await call('admin', 'PATCH', `/admin/orgs/${glamourId}/addons/spaceships`, { body: { enabled: true } });
    expect(res.status).toBe(400);
  });

  it('switches Inventory on for one salon only', async () => {
    const res = await setInventory('admin', true);
    expect(res.status).toBe(200);
    expect(res.json.org.addons.inventory.enabled).toBe(true);
    expect(res.json.org.addons.inventory.enabledAt).toBeTruthy();

    const me = await call('business', 'GET', '/auth/me');
    expect(me.json.user.org.addons).toEqual(['inventory']);
    const salon = await call('admin', 'GET', `/admin/orgs/${f.ctxDesert.orgId}`);
    expect(salon.json.org.addons.inventory.enabled).toBe(false);
  });
});

describe('Add-on on', () => {
  beforeAll(async () => {
    cookies.inventory = (await login('suresh@g.com')).cookie;
  });

  it('owners and the front desk can open Inventory', async () => {
    for (const who of ['business', 'bandraOwner', 'desk', 'inventory']) {
      expect((await call(who, 'GET', '/inventory/access')).status).toBe(200);
    }
  });

  it('gives each role the right permissions (PRD launch defaults)', async () => {
    const access = async (who) => (await call(who, 'GET', '/inventory/access')).json;

    const owner = await access('business');
    expect(owner.role).toBe('BUSINESS_OWNER');
    expect(Object.values(owner.can).every(Boolean)).toBe(true);

    const desk = await access('desk');
    expect(desk.role).toBe('FRONT_DESK');
    expect(desk.can['inventory.finish']).toBe(true); // on by default
    expect(desk.can['inventory.reportProblem']).toBe(true);
    for (const action of ['issue', 'transfer', 'receive', 'writeOff', 'viewCosts', 'editProducts', 'createPurchaseOrder', 'manageSettings']) {
      expect(desk.can[`inventory.${action}`], action).toBe(false);
    }

    const store = await access('inventory');
    expect(store.role).toBe('INVENTORY');
    expect(store.branchId).toBe(String(f.andheri._id));
    expect(store.can['inventory.issue']).toBe(true);
    expect(store.can['inventory.createPurchaseOrder']).toBe(true);
    for (const action of ['viewCosts', 'approvePurchaseOrder', 'editRecipes', 'manageSettings', 'approveStockCount']) {
      expect(store.can[`inventory.${action}`], action).toBe(false);
    }
  });

  it('an owner creates an inventory login for one branch, with a temporary password', async () => {
    const res = await call('business', 'POST', '/users', { body: { role: 'INVENTORY', name: 'Store Man', email: 'store@g.com', branchIds: [String(f.bandra._id)] } });
    expect(res.status).toBe(201);
    expect(res.json.user.role).toBe('INVENTORY');
    expect(res.json.temporaryPassword).toBeTruthy();

    const list = await call('business', 'GET', '/users');
    expect(list.json.users.some((u) => u.email === 'store@g.com')).toBe(true);
  });

  it('an inventory login works in exactly one branch', async () => {
    const res = await call('business', 'POST', '/users', {
      body: { role: 'INVENTORY', name: 'Two Branches', email: 'two@g.com', branchIds: [String(f.andheri._id), String(f.bandra._id)] },
    });
    expect(res.status).toBe(400);
  });

  it("a branch owner can't create one for another branch, or manage another branch's", async () => {
    const res = await call('bandraOwner', 'POST', '/users', { body: { role: 'INVENTORY', name: 'Spy', email: 'spy@g.com', branchIds: [String(f.andheri._id)] } });
    expect(res.status).toBe(400);
    const suresh = await User.findOne({ email: 'suresh@g.com' });
    expect((await call('bandraOwner', 'PATCH', `/users/${suresh._id}/status`, { body: { status: 'inactive' } })).status).toBe(404);
    expect((await call('bandraOwner', 'GET', '/users')).json.users.some((u) => u.email === 'suresh@g.com')).toBe(false);
  });

  it("the front desk can't create logins", async () => {
    const res = await call('desk', 'POST', '/users', { body: { role: 'INVENTORY', name: 'Desk Made', email: 'desk-made@g.com', branchIds: [String(f.andheri._id)] } });
    expect(res.status).toBe(403);
  });
});

describe('Inventory login', () => {
  // Every non-inventory API: all must be refused
  const blocked = [
    ['GET', '/branches'],
    ['GET', `/branches/${'0'.repeat(24)}`],
    ['GET', '/staff'],
    ['POST', '/staff', { name: 'Spy', role: 'Stylist' }],
    ['GET', '/services'],
    ['GET', '/combos'],
    ['GET', '/customers'],
    ['POST', '/customers', { name: 'Spy', phone: '9800000000' }],
    ['GET', '/leads'],
    ['GET', '/appointments'],
    ['POST', '/appointments', {}],
    ['GET', '/availability'],
    ['POST', '/invoices', {}],
    ['GET', '/attendance'],
    ['PUT', '/attendance', {}],
    ['GET', '/dashboard'],
    ['GET', '/analytics'],
    ['GET', '/payroll/staff'],
    ['GET', '/payroll/requests'],
    ['GET', '/activity'],
    ['GET', '/users'],
    ['POST', '/users', { role: 'FRONT_DESK', name: 'Spy', email: 'spy2@g.com', branchIds: [] }],
    ['GET', '/help/start'],
    ['GET', '/admin/orgs'],
  ];
  for (const [method, path, body] of blocked) {
    it(`can't ${method} ${path}`, async () => {
      expect((await call('inventory', method, path, { body })).status).toBe(403);
    });
  }

  it('still has the bell', async () => {
    expect((await call('inventory', 'GET', '/notifications')).status).toBe(200);
  });

  it("from Andheri can't reach Bandra", async () => {
    const res = await call('inventory', 'GET', '/inventory/access', { branch: f.bandra._id });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('BRANCH_FORBIDDEN');
  });

  it("can't use another salon's branch either", async () => {
    expect((await call('inventory', 'GET', '/inventory/access', { branch: f.marina._id })).status).toBe(403);
  });
});

describe('Branch owner', () => {
  it("can't open Inventory for a branch they don't manage", async () => {
    expect((await call('bandraOwner', 'GET', '/inventory/access', { branch: f.andheri._id })).status).toBe(403);
    expect((await call('bandraOwner', 'GET', '/inventory/access', { branch: f.bandra._id })).status).toBe(200);
  });
});

describe('Switching the add-on off again', () => {
  it('closes Inventory, logs inventory logins out, and keeps their accounts', async () => {
    expect((await setInventory('admin', false)).status).toBe(200);

    expect((await call('business', 'GET', '/inventory/access')).json.error.code).toBe('ADDON_DISABLED');
    const kicked = await call('inventory', 'GET', '/notifications');
    expect(kicked.status).toBe(401);
    expect(kicked.json.error.code).toBe('ADDON_DISABLED');
    expect(await User.exists({ email: 'suresh@g.com', status: 'active' })).toBeTruthy();
    // The rest of the app is unchanged for everyone else
    expect((await call('business', 'GET', '/staff')).status).toBe(200);
    expect((await call('desk', 'GET', '/appointments')).status).toBe(200);
  });
});

describe('Permission rules (limits and approvals)', () => {
  const ctx = (role, isPrimaryOwner = false) => ({ ...f.ctxGlamour, role, isPrimaryOwner });
  let settings;
  beforeAll(async () => {
    settings = await getBranchSettings(f.ctxGlamour, f.andheri._id);
  });

  it('uses the defaults when a branch has no saved settings', () => {
    expect(settings.frontDesk).toEqual({ finish: true, issue: false, transfer: false, receive: false });
    expect(settings.limits.inventoryWriteOff).toBe(200000);
  });

  it('an inventory login writes off up to the branch limit; above it, an owner approves', () => {
    expect(can(ctx('INVENTORY'), 'inventory.writeOff', { settings, value: 200000 })).toEqual({ allowed: true, needsApproval: false });
    expect(can(ctx('INVENTORY'), 'inventory.writeOff', { settings, value: 200001 })).toEqual({ allowed: true, needsApproval: true });
    // An unknown value counts as over the limit
    expect(can(ctx('INVENTORY'), 'inventory.writeOff', { settings })).toEqual({ allowed: true, needsApproval: true });
  });

  it('the business owner has no limits; the front desk can never write off', () => {
    expect(can(ctx('OWNER', true), 'inventory.writeOff', { settings, value: 99_999_999 }).needsApproval).toBe(false);
    expect(can(ctx('FRONT_DESK'), 'inventory.writeOff', { settings, value: 1 }).allowed).toBe(false);
  });

  it('a branch owner approves orders only up to their limit', () => {
    expect(can(ctx('OWNER'), 'inventory.approvePurchaseOrder', { settings, value: 2500000 }).allowed).toBe(true);
    expect(can(ctx('OWNER'), 'inventory.approvePurchaseOrder', { settings, value: 2500001 }).allowed).toBe(false);
  });

  it('orders from an inventory login always wait for approval', () => {
    expect(can(ctx('INVENTORY'), 'inventory.createPurchaseOrder', { settings })).toEqual({ allowed: true, needsApproval: true });
  });

  it('front desk switches follow the branch settings', () => {
    const on = { ...settings, frontDesk: { ...settings.frontDesk, issue: true, finish: false } };
    expect(can(ctx('FRONT_DESK'), 'inventory.issue', { settings: on }).allowed).toBe(true);
    expect(can(ctx('FRONT_DESK'), 'inventory.finish', { settings: on }).allowed).toBe(false);
  });

  it('the Super Admin has no access to stock', () => {
    expect(can({ role: 'SUPER_ADMIN' }, 'inventory.view', { settings }).allowed).toBe(false);
  });
});
