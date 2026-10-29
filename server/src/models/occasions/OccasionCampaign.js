import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { CAMPAIGN_SCOPES, CAMPAIGN_STATUSES, DELIVERY_MODES, OCCASION_TYPES } from '../../config/occasions.js';
import { campaignRulesSchema } from './campaignRules.js';

// A Birthday or Anniversary offer, set up once and repeated every year. Its published terms live in
// OccasionCampaignVersion rows (never changed); editing a live campaign saves draftRules for the next version.
const occasionCampaignSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    type: { type: String, enum: OCCASION_TYPES, required: true }, // fixed after the first publish
    scope: { type: String, enum: CAMPAIGN_SCOPES, required: true }, // fixed after the first publish
    branchId: ref('Branch', { default: null }), // BRANCH_ONLY: the branch whose customers it covers
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'DRAFT' },
    currentVersion: { type: Number, default: 0 }, // 0 = never published
    currentVersionId: ref('OccasionCampaignVersion', { default: null }),
    draftRules: { type: campaignRulesSchema, default: null }, // unpublished terms (a draft, or the next version)
    deliveryMode: { type: String, enum: DELIVERY_MODES, default: 'STAFF_ASSISTED' },
    version: { type: Number, default: 0 }, // goes up on every change, so two people can't overwrite each other
    createdBy: ref('User'),
    updatedBy: ref('User'),
    publishedAt: Date, // the first publish
    disabledAt: Date,
    archivedAt: Date,
  },
  { timestamps: true, collection: 'occasion_campaigns' }
);

occasionCampaignSchema.index({ orgId: 1, type: 1, status: 1 });
// Only one live campaign per occasion and scope (per branch for branch campaigns)
occasionCampaignSchema.index({ orgId: 1, type: 1, scope: 1, branchId: 1 }, { unique: true, partialFilterExpression: { status: 'PUBLISHED' }, name: 'one_published_per_scope' });

export default mongoose.model('OccasionCampaign', occasionCampaignSchema);
