// Birthday & Anniversary Offers, Phase 2: campaigns, quick setup starters, versions, branch overrides,
// audience preview, turn off and archive. PRD AT-31 (front desk edit -> 403 + logged, nothing changed).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { ActivityLog, Customer, OccasionCampaign, OccasionCampaignVersion, Service, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { checkRules, describeOffer, sameRules } from '../src/modules/occasions/campaigns/campaign.rules.js';
import { winningCampaign } from '../src/modules/occasions/campaigns/audience.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
let server;
let api;
let f;
const cookies = {};
const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(who, method, path, { body, key = method === 'GET' ? null : newKey(), headers = {} } = {}) {
  const all = { 'content-type': 'application/json', cookie: cookies[who], ...headers };
  if (key) all['idempotency-key'] = key;
  const res = await fetch(`${api}${path}`, { method, headers: all, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const thisMonth = DateTime.now().setZone('Asia/Kolkata').month;
const otherMonth = (thisMonth % 12) + 1;
let allServiceIds;
const percentRules = (extra = {}) => ({ discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds: allServiceIds, ...extra });
const get = (who, id) => call(who, 'GET', `/occasions/campaigns/${id}`);
const patch = (who, id, body, version) => call(who, 'PATCH', `/occasions/campaigns/${id}`, { body, headers: { 'if-match': String(version) } });
const act = (who, id, action) => call(who, 'POST', `/occasions/campaigns/${id}/${action}`);
const create = (who, body) => call(who, 'POST', '/occasions/campaigns', { body: { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday', rules: percentRules(), ...body } });

let birthdayId;
let anniversaryId;
let bandraId;

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Bilal', email: 'bilal@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Layla', email: 'layla@d.com', passwordHash, allBranches: true },
  ]);
  // Birthdays this month: Priya (Andheri, WhatsApp opted in) and Rohan (Bandra); Sara's is next month
  await Customer.create([
    { orgId: g, name: 'Rohan', phone: '9811100001', homeBranchId: f.bandra._id, occasions: { birthday: { month: thisMonth, source: 'STAFF' } } },
    { orgId: g, name: 'Sara', phone: '9811100002', homeBranchId: f.andheri._id, occasions: { birthday: { month: otherMonth, source: 'STAFF' } } },
  ]);
  await migrateOccasions({ log: () => {} });
  await Customer.updateOne({ _id: f.priya._id }, { $set: { 'occasions.birthday': { month: thisMonth, day: 1, source: 'STAFF' }, 'marketing.WHATSAPP.status': 'OPTED_IN' } });
  allServiceIds = (await Service.find({ orgId: g })).map((s) => String(s._id));

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', branchOwner: 'bilal@g.com', desk: 'kavya@g.com', desert: 'layla@d.com' })) {
    cookies[who] = await login(email);
  }
});

afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('rule checks', () => {
  const statuses = new Map([
    ['a', 'active'],
    ['b', 'disabled'],
  ]);
  const problems = (rules) => checkRules({ minSubtotal: 0, serviceIds: ['a'], ...rules }, statuses).map((p) => p.field);

  it('% must be above 0 and at most 100, with a max up to ₹1,00,000; flat above 0; minimum not negative', () => {
    expect(problems({ discountType: 'PERCENT', value: 1500, maxDiscount: 50000 })).toEqual([]);
    expect(problems({ discountType: 'PERCENT', value: 0, maxDiscount: 50000 })).toEqual(['value']);
    expect(problems({ discountType: 'PERCENT', value: 10001, maxDiscount: 50000 })).toEqual(['value']);
    expect(problems({ discountType: 'PERCENT', value: 1000, maxDiscount: null })).toEqual(['maxDiscount']);
    expect(problems({ discountType: 'PERCENT', value: 1000, maxDiscount: 1_00_000_01 })).toEqual(['maxDiscount']);
    expect(problems({ discountType: 'FLAT', value: 0 })).toEqual(['value']);
    expect(problems({ discountType: 'FLAT', value: 30000, minSubtotal: -1 })).toEqual(['minSubtotal']);
  });

  it('needs at least one active service, all of them known', () => {
    expect(problems({ discountType: 'FLAT', value: 100, serviceIds: ['b'] })).toEqual(['serviceIds']);
    expect(problems({ discountType: 'FLAT', value: 100, serviceIds: [] })).toEqual(['serviceIds']);
    expect(problems({ discountType: 'FLAT', value: 100, serviceIds: ['a', 'x'] })).toEqual(['serviceIds']);
    expect(problems({ discountType: 'FLAT', value: 100, serviceIds: ['a', 'b'] })).toEqual([]);
  });

  it('describes offers in plain words and compares terms', () => {
    expect(describeOffer({ discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0 })).toBe('15% off (max ₹500)');
    expect(describeOffer({ discountType: 'FLAT', value: 30000, minSubtotal: 150000 })).toBe('₹300 off on ₹1,500+');
    expect(sameRules({ discountType: 'FLAT', value: 1, serviceIds: ['a', 'b'] }, { discountType: 'FLAT', value: 1, maxDiscount: 5, serviceIds: ['b', 'a'] })).toBe(true);
  });

  it('the winning campaign is the home branch’s own one, otherwise the salon-wide one', () => {
    const salon = { _id: 's' };
    const bandra = { _id: 'b' };
    const published = { salon, byBranch: new Map([['B', bandra]]) };
    expect(winningCampaign(published, 'B')).toBe(bandra);
    expect(winningCampaign(published, 'A')).toBe(salon);
    expect(winningCampaign({ salon: null, byBranch: new Map() }, 'A')).toBeNull();
  });
});

describe('quick setup and publishing', () => {
  it('the front desk cannot start the setup (403, logged, nothing created)', async () => {
    const res = await call('desk', 'POST', '/occasions/campaigns/starters');
    expect(res.status).toBe(403);
    expect(await OccasionCampaign.countDocuments()).toBe(0);
    expect(await ActivityLog.exists({ action: 'occasions.refused', actorName: 'Kavya' })).toBeTruthy();
  });

  it('saves the starting suggestions as drafts, once', async () => {
    const res = await call('business', 'POST', '/occasions/campaigns/starters');
    expect(res.status).toBe(201);
    expect(res.json.created).toHaveLength(2);
    const list = await call('business', 'GET', '/occasions/campaigns');
    const [birthday, anniversary] = list.json.campaigns;
    expect(birthday).toMatchObject({ type: 'BIRTHDAY', status: 'DRAFT', scope: 'BUSINESS_DEFAULT', offerSummary: '15% off (max ₹500)', currentVersion: 0 });
    expect(anniversary).toMatchObject({ type: 'ANNIVERSARY', status: 'DRAFT', offerSummary: '₹300 off on ₹1,500+' });
    expect(birthday.rules.serviceIds).toHaveLength(allServiceIds.length); // all active services by default
    birthdayId = birthday._id;
    anniversaryId = anniversary._id;
    expect((await call('business', 'POST', '/occasions/campaigns/starters')).json.created).toHaveLength(0);
  });

  it('can’t publish while the feature is off; publishing makes version 1', async () => {
    expect((await act('business', birthdayId, 'publish')).json.error.code).toBe('FEATURE_OFF');
    const settings = await call('business', 'GET', '/occasions/settings');
    await call('business', 'PUT', '/occasions/settings', { body: { enabled: true }, headers: { 'if-match': String(settings.json.version) } });

    const res = await act('business', birthdayId, 'publish');
    expect(res.status).toBe(200);
    expect(res.json.campaign).toMatchObject({ status: 'PUBLISHED', currentVersion: 1, hasDraft: false });
    const versions = await call('business', 'GET', `/occasions/campaigns/${birthdayId}/versions`);
    expect(versions.json.versions).toHaveLength(1);
    expect(versions.json.versions[0]).toMatchObject({ version: 1, publishedByName: 'Anita', offerSummary: '15% off (max ₹500)' });
    expect(await ActivityLog.exists({ action: 'occasions.campaign_published' })).toBeTruthy();
  });

  it('AT-31: a front desk edit is refused with 403 and logged, and nothing changes', async () => {
    const before = await OccasionCampaign.findById(birthdayId).lean();
    const res = await patch('desk', birthdayId, { name: 'Hacked', rules: percentRules({ value: 9000 }) }, before.version);
    expect(res.status).toBe(403);
    expect(await OccasionCampaign.findById(birthdayId).lean()).toEqual(before);
    expect(await ActivityLog.exists({ action: 'occasions.refused', summary: /edit a campaign/ })).toBeTruthy();
    expect((await call('desk', 'GET', '/occasions/campaigns')).status).toBe(403);
  });

  it('editing a live campaign saves a draft; publishing it makes version 2 while version 1 stays as it was', async () => {
    const current = (await get('business', birthdayId)).json.campaign;
    const v1 = await OccasionCampaignVersion.findOne({ campaignId: birthdayId, version: 1 }).lean();

    expect((await patch('business', birthdayId, { name: 'Late' }, current.version + 3)).status).toBe(409); // stale
    const edited = await patch('business', birthdayId, { rules: percentRules({ value: 2000 }) }, current.version);
    expect(edited.json.campaign).toMatchObject({ status: 'PUBLISHED', currentVersion: 1, hasDraft: true, offerSummary: '15% off (max ₹500)', draftSummary: '20% off (max ₹500)' });

    const published = await act('business', birthdayId, 'publish');
    expect(published.json.campaign).toMatchObject({ currentVersion: 2, hasDraft: false, offerSummary: '20% off (max ₹500)' });
    expect(await OccasionCampaignVersion.findOne({ campaignId: birthdayId, version: 1 }).lean()).toEqual(v1);
    await expect(OccasionCampaignVersion.updateOne({ _id: v1._id }, { $set: { 'rules.value': 1 } })).rejects.toThrow(/cannot be changed/);

    // Nothing left to publish; editing back to the live terms clears the draft
    expect((await act('business', birthdayId, 'publish')).json.error.code).toBe('NOTHING_TO_PUBLISH');
    const again = (await get('business', birthdayId)).json.campaign;
    await patch('business', birthdayId, { rules: percentRules({ value: 2500 }) }, again.version);
    const back = (await get('business', birthdayId)).json.campaign;
    const cleared = await patch('business', birthdayId, { rules: percentRules({ value: 2000 }) }, back.version);
    expect(cleared.json.campaign.hasDraft).toBe(false);
  });

  it('the occasion can’t change after publishing, and only one campaign per occasion and scope is live', async () => {
    const current = (await get('business', birthdayId)).json.campaign;
    expect((await patch('business', birthdayId, { type: 'ANNIVERSARY' }, current.version)).json.error.code).toBe('LOCKED_AFTER_PUBLISH');

    expect((await create('business', { name: 'birthday month offer' })).json.error.code).toBe('NAME_TAKEN'); // case doesn't matter
    const second = await create('business', { name: 'Second birthday' });
    expect(second.status).toBe(201);
    expect((await act('business', second.json.campaign._id, 'publish')).json.error.code).toBe('ALREADY_LIVE');
    expect((await act('business', second.json.campaign._id, 'archive')).status).toBe(200); // a draft can be archived
  });

  it('refuses bad terms', async () => {
    expect((await create('business', { name: 'No cap', rules: percentRules({ maxDiscount: null }) })).json.error.code).toBe('INVALID_RULES');
    expect((await create('business', { name: 'No services', rules: percentRules({ serviceIds: [] }) })).json.error.code).toBe('INVALID_RULES');
    expect((await create('business', { name: 'Huge', rules: percentRules({ value: 12000 }) })).status).toBe(400);
  });
});

describe('branch campaigns', () => {
  it('a branch owner sees the salon-wide campaign read-only and can’t change it (logged)', async () => {
    const view = await get('branchOwner', birthdayId);
    expect(view.json.campaign.canManage).toBe(false);
    const res = await patch('branchOwner', birthdayId, { name: 'Mine now' }, view.json.campaign.version);
    expect(res.status).toBe(403);
    expect(await ActivityLog.exists({ action: 'occasions.refused', actorName: 'Bilal' })).toBeTruthy();
    expect((await create('branchOwner', { name: 'Salon wide' })).status).toBe(403);
    // ...nor create one for another branch
    expect((await create('branchOwner', { scope: 'BRANCH_ONLY', branchId: String(f.andheri._id), name: 'Andheri special' })).json.error.code).toBe('INVALID_BRANCH');
  });

  it('a branch campaign overrides the salon-wide one for its home-branch customers', async () => {
    const before = await call('business', 'GET', `/occasions/campaigns/${birthdayId}/preview`);
    expect(before.json.customers.map((c) => c.name).sort()).toEqual(['Priya', 'Rohan']);
    expect(before.json).toMatchObject({ eligible: 2, canMessage: 1 });
    expect(before.json.customers.find((c) => c.name === 'Priya').phone).toBe('98******10');

    const res = await create('branchOwner', { scope: 'BRANCH_ONLY', branchId: String(f.bandra._id), name: 'Bandra birthday', rules: percentRules({ value: 2500 }) });
    expect(res.status).toBe(201);
    bandraId = res.json.campaign._id;
    // Preview works before publishing, and saves nothing
    expect((await call('branchOwner', 'GET', `/occasions/campaigns/${bandraId}/preview`)).json).toMatchObject({ eligible: 1 });
    expect((await act('branchOwner', bandraId, 'publish')).json.campaign.status).toBe('PUBLISHED');

    const salonWide = await call('business', 'GET', `/occasions/campaigns/${birthdayId}/preview`);
    expect(salonWide.json.customers.map((c) => c.name)).toEqual(['Priya']);
    const bandra = await call('business', 'GET', `/occasions/campaigns/${bandraId}/preview`);
    expect(bandra.json.customers.map((c) => c.name)).toEqual(['Rohan']);

    // The settings list adds up the live campaigns' audiences
    const list = await call('business', 'GET', '/occasions/campaigns');
    expect(list.json.audience).toMatchObject({ eligible: 2, canMessage: 1 });
    expect(list.json.campaigns.find((c) => c._id === bandraId).scopeLabel).toBe('Bandra only');
    // A branch owner's list: the salon-wide ones and their own branch's
    const theirs = await call('branchOwner', 'GET', '/occasions/campaigns');
    expect(theirs.json.campaigns.every((c) => c.scope === 'BUSINESS_DEFAULT' || c.branchName === 'Bandra')).toBe(true);
  });
});

describe('turn off, on and archive', () => {
  it('only a turned-off campaign can be archived; turning back on checks nothing else is live', async () => {
    expect((await act('business', anniversaryId, 'disable')).json.error.code).toBe('WRONG_STATUS'); // still a draft
    expect((await act('business', birthdayId, 'archive')).json.error.code).toBe('WRONG_STATUS'); // live

    expect((await act('business', birthdayId, 'disable')).json.campaign.status).toBe('DISABLED');
    const other = await create('business', { name: 'Replacement birthday' });
    expect((await act('business', other.json.campaign._id, 'publish')).status).toBe(200);
    expect((await act('business', birthdayId, 'enable')).json.error.code).toBe('ALREADY_LIVE');

    expect((await act('business', birthdayId, 'archive')).json.campaign.status).toBe('ARCHIVED');
    const current = (await get('business', birthdayId)).json.campaign;
    expect((await patch('business', birthdayId, { name: 'Revive' }, current.version)).json.error.code).toBe('ARCHIVED');
    const list = await call('business', 'GET', '/occasions/campaigns');
    expect(list.json.campaigns.some((c) => c._id === birthdayId)).toBe(false);
    expect(await OccasionCampaignVersion.countDocuments({ campaignId: birthdayId })).toBe(2); // versions are kept
  });
});

describe('salon walls', () => {
  it('another salon can’t see or touch these campaigns', async () => {
    expect((await get('desert', bandraId)).status).toBe(404);
    expect((await call('desert', 'GET', `/occasions/campaigns/${bandraId}/versions`)).status).toBe(404);
    expect((await call('desert', 'GET', `/occasions/campaigns/${bandraId}/preview`)).status).toBe(404);
    expect((await act('desert', bandraId, 'disable')).status).toBe(404);
    expect((await call('desert', 'GET', '/occasions/campaigns')).json.campaigns).toEqual([]);
  });
});
