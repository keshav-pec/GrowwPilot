import { Branch, OccasionCampaign, OccasionCampaignVersion, Organization, Service } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { escapeRegex } from '../../../utils/regex.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { logActivity } from '../../activity/activity.service.js';
import { OCCASION_LABELS, OCCASION_TYPES } from '../../../config/occasions.js';
import { assertCan, assertCanOrLog, can, refuseAndLog } from '../permissions.js';
import { STARTER_CAMPAIGNS, checkRules, cleanRules, describeOffer, sameRules } from './campaign.rules.js';
import { campaignAudience } from './audience.js';
import { campaignMessages, checkMessages } from '../outreach/templates.js';

// Birthday and Anniversary campaigns: drafts, publishing (each publish freezes a new version), turning off and
// on, archiving. The business owner manages every campaign; a branch owner only "This branch only" campaigns of
// their own branches and sees the salon-wide ones read-only. The front desk has no access (a refused change is logged).

const scopeWords = (c, branchName) => (c.scope === 'BRANCH_ONLY' ? `${branchName ?? 'one branch'} only` : 'all branches');
const STALE = () => new AppError(409, 'STALE_CAMPAIGN', 'Someone else changed this campaign a moment ago. Please reload and try again.');

// The campaigns this user may see: everything for the business owner; for a branch owner the salon-wide ones
// and their own branches' campaigns
function visibleFilter(ctx, extra = {}) {
  if (ctx.isPrimaryOwner) return scoped(ctx, extra);
  return scoped(ctx, { $or: [{ scope: 'BUSINESS_DEFAULT' }, { scope: 'BRANCH_ONLY', branchId: { $in: ctx.allowedBranchIds } }], ...extra });
}

export function canManageCampaign(ctx, campaign) {
  if (!can(ctx, 'occasions.manageCampaigns')) return false;
  if (campaign.scope === 'BUSINESS_DEFAULT') return can(ctx, 'occasions.manageSalonCampaigns');
  return ctx.isPrimaryOwner || ctx.allowedBranchIds.includes(String(campaign.branchId));
}

// A campaign this user may change. Refusals are logged; a campaign they can't even see is "not found".
async function campaignToChange(ctx, id, what, session = null) {
  await assertCanOrLog(ctx, 'occasions.manageCampaigns', what);
  const campaign = await OccasionCampaign.findOne(visibleFilter(ctx, { _id: id })).session(session).lean();
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
  if (!canManageCampaign(ctx, campaign)) await refuseAndLog(ctx, `${what} (${campaign.name})`);
  return campaign;
}

// serviceId -> 'active' | 'disabled', for the rule checks
async function serviceStatuses(ctx, session = null) {
  const services = await Service.find(scoped(ctx)).select('status').session(session).lean();
  return new Map(services.map((s) => [String(s._id), s.status]));
}

async function assertRules(ctx, rules, session = null) {
  const problems = checkRules(rules, await serviceStatuses(ctx, session));
  if (problems.length > 0) throw new AppError(400, 'INVALID_RULES', problems[0].message, problems);
}

// Names are unique per occasion and scope among campaigns that aren't archived
async function assertNameFree(ctx, { type, scope, branchId, name }, exceptId, session = null) {
  const filter = scoped(ctx, { type, scope, branchId: branchId ?? null, status: { $ne: 'ARCHIVED' }, name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') });
  if (exceptId) filter._id = { $ne: exceptId };
  if (await OccasionCampaign.exists(filter).session(session)) throw new AppError(409, 'NAME_TAKEN', `Another ${OCCASION_LABELS[type]} campaign is already called “${name.trim()}”`);
}

// Only one live campaign per occasion and scope
async function assertNoOtherLive(ctx, campaign, session) {
  const other = await OccasionCampaign.findOne(scoped(ctx, { type: campaign.type, scope: campaign.scope, branchId: campaign.branchId ?? null, status: 'PUBLISHED', _id: { $ne: campaign._id } }))
    .session(session)
    .lean();
  if (other) throw new AppError(409, 'ALREADY_LIVE', `“${other.name}” is already live for the same occasion and branches. Turn it off first.`);
}

async function assertFeatureOn(ctx, session) {
  const org = await Organization.findById(ctx.orgId).select('occasionOffers').session(session).lean();
  if (!org?.occasionOffers?.enabled) throw new AppError(409, 'FEATURE_OFF', 'Switch on Birthday & Anniversary Offers first (Settings → Occasion offers)');
}

// A branch for a "This branch only" campaign: an active branch this user works at
async function assertBranch(ctx, branchId, session = null) {
  if (!branchId || !ctx.allowedBranchIds.includes(String(branchId))) throw new AppError(400, 'INVALID_BRANCH', 'Choose one of your branches');
  const branch = await Branch.findOne(scoped(ctx, { _id: branchId, status: 'active' })).select('name').session(session).lean();
  if (!branch) throw new AppError(400, 'INVALID_BRANCH', 'Choose one of your branches');
  return branch;
}

// What the screens get for one campaign. `published`: its current version row (or null)
function toView(ctx, campaign, { published, branchName }) {
  const liveRules = published?.rules ?? null;
  return {
    _id: campaign._id,
    name: campaign.name,
    type: campaign.type,
    scope: campaign.scope,
    branchId: campaign.branchId,
    branchName: branchName ?? null,
    scopeLabel: campaign.scope === 'BRANCH_ONLY' ? `${branchName ?? 'Branch'} only` : 'All branches',
    status: campaign.status,
    deliveryMode: campaign.deliveryMode,
    currentVersion: campaign.currentVersion,
    version: campaign.version,
    rules: liveRules ?? campaign.draftRules, // what it gives now (or would give, while a draft)
    offerSummary: describeOffer(liveRules ?? campaign.draftRules),
    draftRules: campaign.draftRules,
    hasDraft: Boolean(campaign.draftRules) && campaign.currentVersion > 0, // unpublished changes to a live campaign
    draftSummary: campaign.draftRules ? describeOffer(campaign.draftRules) : null,
    publishedAt: campaign.publishedAt ?? null,
    updatedAt: campaign.updatedAt,
    messages: campaignMessages(campaign), // the ready-made WhatsApp / SMS / email wording (defaults if never changed)
    messagesChanged: Boolean(campaign.messages),
    canManage: canManageCampaign(ctx, campaign),
  };
}

async function viewsOf(ctx, campaigns) {
  const versionIds = campaigns.map((c) => c.currentVersionId).filter(Boolean);
  const [versions, branches] = await Promise.all([
    versionIds.length ? OccasionCampaignVersion.find(scoped(ctx, { _id: { $in: versionIds } })).lean() : [],
    Branch.find(scoped(ctx)).select('name').lean(),
  ]);
  const versionById = new Map(versions.map((v) => [String(v._id), v]));
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));
  return campaigns.map((c) => toView(ctx, c, { published: versionById.get(String(c.currentVersionId)) ?? null, branchName: branchName.get(String(c.branchId)) }));
}

const TYPE_ORDER = { BIRTHDAY: 0, ANNIVERSARY: 1 };
const STATUS_ORDER = { PUBLISHED: 0, DRAFT: 1, DISABLED: 2, ARCHIVED: 3 };

// GET /api/occasions/campaigns — the campaigns, plus this month's audience of the live ones
export async function listCampaigns(ctx, { includeArchived = false } = {}) {
  assertCan(ctx, 'occasions.viewCampaigns');
  const campaigns = await OccasionCampaign.find(visibleFilter(ctx, includeArchived ? {} : { status: { $ne: 'ARCHIVED' } })).lean();
  campaigns.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (a.scope === b.scope ? 0 : a.scope === 'BUSINESS_DEFAULT' ? -1 : 1) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));

  // Live campaigns cover separate customers (a branch campaign takes its branch out of the salon-wide one), so they add up
  const live = campaigns.filter((c) => c.status === 'PUBLISHED');
  const audiences = await Promise.all(live.map((c) => campaignAudience(ctx, c, { limit: 0 })));
  const audience = audiences.reduce((sum, a) => ({ eligible: sum.eligible + a.eligible, canMessage: sum.canMessage + a.canMessage }), { eligible: 0, canMessage: 0 });

  return {
    campaigns: await viewsOf(ctx, campaigns),
    audience: { ...audience, toDo: null }, // "still to do" comes with the front desk list (Phase 3)
    delivery: { mode: 'STAFF_ASSISTED', ready: true },
    can: {
      createSalonCampaign: can(ctx, 'occasions.manageSalonCampaigns'),
      createBranchCampaign: can(ctx, 'occasions.manageCampaigns'),
    },
  };
}

// GET /api/occasions/campaigns/:id
export async function getCampaign(ctx, id) {
  assertCan(ctx, 'occasions.viewCampaigns');
  const campaign = await OccasionCampaign.findOne(visibleFilter(ctx, { _id: id })).lean();
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
  const [view] = await viewsOf(ctx, [campaign]);
  return { campaign: view };
}

// POST /api/occasions/campaigns — { type, scope, branchId?, name, rules } -> a draft
export async function createCampaign(ctx, input, key) {
  await assertCanOrLog(ctx, 'occasions.manageCampaigns', `create a ${OCCASION_LABELS[input.type]} campaign`);
  if (input.scope === 'BUSINESS_DEFAULT') await assertCanOrLog(ctx, 'occasions.manageSalonCampaigns', `create a salon-wide ${OCCASION_LABELS[input.type]} campaign`);

  return runOnce(ctx, { key, operation: 'occasions.campaign.create' }, async (session) => {
    const branch = input.scope === 'BRANCH_ONLY' ? await assertBranch(ctx, input.branchId, session) : null;
    const fields = { type: input.type, scope: input.scope, branchId: branch?._id ?? null, name: input.name.trim() };
    await assertNameFree(ctx, fields, null, session);
    const rules = cleanRules(input.rules);
    await assertRules(ctx, rules, session);
    const [campaign] = await OccasionCampaign.create([{ orgId: ctx.orgId, ...fields, draftRules: rules, createdBy: ctx.userId, updatedBy: ctx.userId }], { session });
    await logActivity(
      ctx,
      { action: 'occasions.campaign_created', branchId: branch?._id ?? null, summary: `Created the draft campaign ${fields.name} (${OCCASION_LABELS[fields.type]}, ${scopeWords(fields, branch?.name)}): ${describeOffer(rules)}` },
      session
    );
    return { campaign: { _id: campaign._id } };
  });
}

// PATCH /api/occasions/campaigns/:id — { name?, rules?, type?, scope?, branchId? }; version: what the screen loaded.
// A live campaign's new rules are saved as the draft of its next version; offers already given keep their terms.
export async function updateCampaign(ctx, id, input, { version, key }) {
  const found = await campaignToChange(ctx, id, 'edit a campaign');
  return runOnce(ctx, { key, operation: 'occasions.campaign.update' }, async (session) => {
    const campaign = await OccasionCampaign.findOne(scoped(ctx, { _id: found._id })).session(session).lean();
    if (campaign.version !== version) throw STALE();
    if (campaign.status === 'ARCHIVED') throw new AppError(409, 'ARCHIVED', 'An archived campaign can’t be changed');

    const set = {};
    const words = [];
    const placement = { type: campaign.type, scope: campaign.scope, branchId: campaign.branchId };
    for (const field of ['type', 'scope', 'branchId']) {
      if (input[field] === undefined || String(input[field] ?? '') === String(campaign[field] ?? '')) continue;
      if (campaign.currentVersion > 0) throw new AppError(400, 'LOCKED_AFTER_PUBLISH', 'The occasion and branches can’t change after a campaign is published. Create a new campaign instead.');
      placement[field] = input[field];
    }
    if (placement.scope === 'BUSINESS_DEFAULT') placement.branchId = null;
    if (placement.type !== campaign.type || placement.scope !== campaign.scope || String(placement.branchId ?? '') !== String(campaign.branchId ?? '')) {
      if (placement.scope === 'BUSINESS_DEFAULT' && !can(ctx, 'occasions.manageSalonCampaigns')) throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to do this');
      if (placement.scope === 'BRANCH_ONLY') placement.branchId = (await assertBranch(ctx, placement.branchId, session))._id;
      Object.assign(set, placement);
      words.push(`now ${OCCASION_LABELS[placement.type]}, ${placement.scope === 'BRANCH_ONLY' ? 'one branch' : 'all branches'}`);
    }

    const name = input.name?.trim() ?? campaign.name;
    if (name !== campaign.name || set.type || set.scope) {
      await assertNameFree(ctx, { ...placement, name }, campaign._id, session);
      if (name !== campaign.name) {
        set.name = name;
        words.push(`renamed to ${name}`);
      }
    }

    if (input.rules !== undefined) {
      const rules = cleanRules(input.rules);
      await assertRules(ctx, rules, session);
      if (campaign.currentVersion === 0) {
        if (!sameRules(rules, campaign.draftRules)) {
          set.draftRules = rules;
          words.push(describeOffer(rules));
        }
      } else {
        const live = await OccasionCampaignVersion.findOne(scoped(ctx, { _id: campaign.currentVersionId })).session(session).lean();
        const next = sameRules(rules, live.rules) ? null : rules;
        if (!sameRules(next, campaign.draftRules)) {
          set.draftRules = next;
          words.push(next ? `changes for version ${campaign.currentVersion + 1}: ${describeOffer(next)} (not published yet)` : 'changes back to the live terms');
        }
      }
    }

    if (words.length === 0) return { changed: false };
    const saved = await OccasionCampaign.updateOne(scoped(ctx, { _id: campaign._id, version }), { $set: { ...set, updatedBy: ctx.userId }, $inc: { version: 1 } }, { session });
    if (saved.matchedCount !== 1) throw STALE();
    await logActivity(ctx, { action: 'occasions.campaign_edited', branchId: set.branchId ?? campaign.branchId ?? null, summary: `Edited the campaign ${campaign.name}: ${words.join('; ')}` }, session);
    return { changed: true };
  });
}

// POST /api/occasions/campaigns/:id/publish — a draft becomes version 1; a live campaign's draft becomes the next version
export async function publishCampaign(ctx, id, key) {
  const found = await campaignToChange(ctx, id, 'publish a campaign');
  return runOnce(ctx, { key, operation: 'occasions.campaign.publish' }, async (session) => {
    await assertFeatureOn(ctx, session);
    const campaign = await OccasionCampaign.findOne(scoped(ctx, { _id: found._id })).session(session).lean();
    if (!['DRAFT', 'PUBLISHED'].includes(campaign.status)) {
      throw new AppError(409, 'CANNOT_PUBLISH', campaign.status === 'DISABLED' ? 'Turn the campaign back on first' : 'An archived campaign can’t be published');
    }
    if (!campaign.draftRules) throw new AppError(409, 'NOTHING_TO_PUBLISH', 'There are no changes to publish');
    await assertRules(ctx, campaign.draftRules, session); // a service may have been switched off since
    await assertNameFree(ctx, campaign, campaign._id, session);
    if (campaign.status === 'DRAFT') await assertNoOtherLive(ctx, campaign, session);

    const now = new Date();
    const number = campaign.currentVersion + 1;
    const [version] = await OccasionCampaignVersion.create(
      [{ orgId: ctx.orgId, campaignId: campaign._id, version: number, type: campaign.type, scope: campaign.scope, branchId: campaign.branchId, name: campaign.name, rules: campaign.draftRules, publishedBy: ctx.userId, publishedByName: ctx.userName, publishedAt: now }],
      { session }
    );
    const saved = await OccasionCampaign.updateOne(
      scoped(ctx, { _id: campaign._id, version: campaign.version }),
      { $set: { status: 'PUBLISHED', currentVersion: number, currentVersionId: version._id, draftRules: null, publishedAt: campaign.publishedAt ?? now, updatedBy: ctx.userId }, $inc: { version: 1 } },
      { session }
    );
    if (saved.matchedCount !== 1) throw STALE();
    await logActivity(
      ctx,
      { action: 'occasions.campaign_published', branchId: campaign.branchId ?? null, summary: `Published ${campaign.name} version ${number}: ${describeOffer(campaign.draftRules)}` },
      session
    );
    // Phase 3: publishing gives this month's offers straight away (the offer engine)
    return { version: number };
  });
}

// Turn off (no new offers; offers already given still work), turn back on, archive (only when off or never published)
const STATUS_CHANGES = {
  disable: { from: ['PUBLISHED'], to: 'DISABLED', words: 'Turned off', refused: 'Only a live campaign can be turned off' },
  enable: { from: ['DISABLED'], to: 'PUBLISHED', words: 'Turned back on', refused: 'Only a turned-off campaign can be turned back on' },
  archive: { from: ['DISABLED', 'DRAFT'], to: 'ARCHIVED', words: 'Archived', refused: 'Turn the campaign off before archiving it' },
};

export async function changeCampaignStatus(ctx, id, change, key) {
  const rule = STATUS_CHANGES[change];
  const found = await campaignToChange(ctx, id, `${change} a campaign`);
  return runOnce(ctx, { key, operation: `occasions.campaign.${change}` }, async (session) => {
    const campaign = await OccasionCampaign.findOne(scoped(ctx, { _id: found._id })).session(session).lean();
    if (!rule.from.includes(campaign.status)) throw new AppError(409, 'WRONG_STATUS', rule.refused);
    if (change === 'enable') {
      await assertFeatureOn(ctx, session);
      await assertNoOtherLive(ctx, campaign, session);
    }
    const now = new Date();
    const stamp = { disable: { disabledAt: now }, enable: {}, archive: { archivedAt: now } }[change];
    const saved = await OccasionCampaign.updateOne(
      scoped(ctx, { _id: campaign._id, status: campaign.status }),
      { $set: { status: rule.to, ...stamp, updatedBy: ctx.userId }, $inc: { version: 1 } },
      { session }
    );
    if (saved.matchedCount !== 1) throw STALE();
    await logActivity(ctx, { action: `occasions.campaign_${change}d`, branchId: campaign.branchId ?? null, summary: `${rule.words} the campaign ${campaign.name}` }, session);
    return { status: rule.to };
  });
}

// POST /api/occasions/campaigns/:id/discard-draft — drop unpublished changes to a live (or turned-off) campaign
export async function discardDraft(ctx, id, key) {
  const found = await campaignToChange(ctx, id, 'discard campaign changes');
  return runOnce(ctx, { key, operation: 'occasions.campaign.discard' }, async (session) => {
    const campaign = await OccasionCampaign.findOne(scoped(ctx, { _id: found._id })).session(session).lean();
    if (campaign.currentVersion === 0 || !campaign.draftRules) throw new AppError(409, 'NOTHING_TO_DISCARD', 'There are no unpublished changes');
    await OccasionCampaign.updateOne(scoped(ctx, { _id: campaign._id }), { $set: { draftRules: null, updatedBy: ctx.userId }, $inc: { version: 1 } }, { session });
    await logActivity(ctx, { action: 'occasions.campaign_edited', branchId: campaign.branchId ?? null, summary: `Discarded the unpublished changes to ${campaign.name}` }, session);
    return { discarded: true };
  });
}

// GET /api/occasions/campaigns/:id/versions — who published what, and when (newest first)
export async function listVersions(ctx, id) {
  assertCan(ctx, 'occasions.viewCampaigns');
  const campaign = await OccasionCampaign.exists(visibleFilter(ctx, { _id: id }));
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
  const versions = await OccasionCampaignVersion.find(scoped(ctx, { campaignId: id })).sort({ version: -1 }).lean();
  return { versions: versions.map((v) => ({ ...v, offerSummary: describeOffer(v.rules) })) };
}

// GET /api/occasions/campaigns/:id/preview — this month's audience as if it were live (count + first 50). Nothing is saved.
export async function previewCampaign(ctx, id) {
  assertCan(ctx, 'occasions.viewCampaigns');
  const campaign = await OccasionCampaign.findOne(visibleFilter(ctx, { _id: id })).lean();
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
  return campaignAudience(ctx, campaign, { limit: 50 });
}

// POST /api/occasions/campaigns/starters — the quick setup's starting suggestions, saved as salon-wide drafts for
// each occasion that has no salon-wide campaign yet. All active services count by default.
export async function createStarterDrafts(ctx, key) {
  await assertCanOrLog(ctx, 'occasions.manageSalonCampaigns', 'start the occasion offers quick setup');
  return runOnce(ctx, { key, operation: 'occasions.campaign.starters' }, async (session) => {
    const services = await Service.find(scoped(ctx, { status: 'active' })).select('_id').session(session).lean();
    if (services.length === 0) throw new AppError(400, 'NO_SERVICES', 'Add your services first (Services & combos)');
    const created = [];
    for (const type of OCCASION_TYPES) {
      const exists = await OccasionCampaign.exists(scoped(ctx, { type, scope: 'BUSINESS_DEFAULT', status: { $ne: 'ARCHIVED' } })).session(session);
      if (exists) continue;
      const starter = STARTER_CAMPAIGNS[type];
      const rules = { ...starter.rules, serviceIds: services.map((s) => String(s._id)) };
      const [campaign] = await OccasionCampaign.create([{ orgId: ctx.orgId, type, scope: 'BUSINESS_DEFAULT', name: starter.name, draftRules: rules, createdBy: ctx.userId, updatedBy: ctx.userId }], { session });
      created.push(campaign._id);
      await logActivity(ctx, { action: 'occasions.campaign_created', summary: `Created the draft campaign ${starter.name} from the starting suggestion: ${describeOffer(rules)}` }, session);
    }
    return { created };
  });
}

// PUT /api/occasions/campaigns/:id/messages — { WHATSAPP: { body }, SMS: { body }, EMAIL: { subject, body } }.
// The wording must keep {first_name}, {salon_name}, {offer_summary}, {expiry_date} and the opt-out line.
export async function updateMessages(ctx, id, messages, { version, key }) {
  const found = await campaignToChange(ctx, id, 'change a campaign’s message wording');
  const problems = checkMessages(messages);
  if (problems.length > 0) throw new AppError(400, 'INVALID_MESSAGES', problems[0].message, problems);
  return runOnce(ctx, { key, operation: 'occasions.campaign.messages' }, async (session) => {
    const saved = await OccasionCampaign.updateOne(scoped(ctx, { _id: found._id, version }), { $set: { messages, updatedBy: ctx.userId }, $inc: { version: 1 } }, { session });
    if (saved.matchedCount !== 1) throw STALE();
    await logActivity(ctx, { action: 'occasions.campaign_edited', branchId: found.branchId ?? null, summary: `Changed the message wording of ${found.name}` }, session);
    return { saved: true };
  });
}
