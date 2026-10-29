import mongoose from 'mongoose';
import { appendOnly, ref } from '../fields.js';
import { CAMPAIGN_SCOPES, OCCASION_TYPES } from '../../config/occasions.js';
import { campaignRulesSchema } from './campaignRules.js';

// One published version of a campaign: the frozen terms. Offers given under it keep these terms even after
// the campaign is edited. Rows are never changed or removed.
const occasionCampaignVersionSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    campaignId: ref('OccasionCampaign', { required: true }),
    version: { type: Number, required: true, min: 1 },
    type: { type: String, enum: OCCASION_TYPES, required: true },
    scope: { type: String, enum: CAMPAIGN_SCOPES, required: true },
    branchId: ref('Branch', { default: null }),
    name: { type: String, required: true },
    rules: { type: campaignRulesSchema, required: true },
    messages: { type: mongoose.Schema.Types.Mixed, default: null }, // WhatsApp / SMS / email wording (Phase 4)
    publishedBy: ref('User', { required: true }),
    publishedByName: { type: String, required: true },
    publishedAt: { type: Date, required: true },
  },
  { collection: 'occasion_campaign_versions' }
);

occasionCampaignVersionSchema.index({ campaignId: 1, version: 1 }, { unique: true });

appendOnly(occasionCampaignVersionSchema, 'Published campaign versions');

export default mongoose.model('OccasionCampaignVersion', occasionCampaignVersionSchema);
