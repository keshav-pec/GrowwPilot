import mongoose from 'mongoose';
import { money, ref } from '../fields.js';
import { CONSENT_CHANNELS, OCCASION_TYPES, OFFER_STATUSES, TASK_KINDS, TASK_STATES } from '../../config/occasions.js';
import { campaignRulesSchema } from './campaignRules.js';

// The front desk's follow-up for one offer. Embedded, so an offer can only ever have one open task.
const taskSchema = new mongoose.Schema(
  {
    state: { type: String, enum: TASK_STATES, default: 'OPEN' },
    kind: { type: String, enum: TASK_KINDS, default: 'CONTACT' },
    dueAt: Date,
    assigneeId: ref('User', { default: null }),
    attempts: { type: Number, default: 0 }, // calls with no answer (Phase 4)
    outcome: { type: String, default: null }, // the last call outcome (Phase 4)
    contactedAt: { type: Date, default: null }, // when the customer was first reached or messaged
    sentAt: { type: Date, default: null }, // the last offer message sent for this offer
    closedReason: { type: String, default: null }, // EXPIRED, REDEEMED, WITHDRAWN, REPLACED, ...
    closedAt: { type: Date, default: null },
  },
  { _id: false }
);

// One customer's offer for one occasion in one year (an "entitlement"), valid for the whole occasion month
// in the issuing branch's time zone. Its terms are frozen from the campaign version it was given under.
const offerIssueSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    customerId: ref('Customer', { required: true }),
    campaignId: ref('OccasionCampaign', { required: true }),
    campaignVersionId: ref('OccasionCampaignVersion', { required: true }),
    campaignName: { type: String, required: true },
    rules: { type: campaignRulesSchema, required: true },
    type: { type: String, enum: OCCASION_TYPES, required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    day: { type: Number, default: null }, // the occasion day, if known (for the list)
    branchId: ref('Branch', { required: true }), // the issuing branch: its time zone sets the month window
    homeBranchId: ref('Branch', { required: true }), // the customer's home branch now: whose list it shows on
    // Copied from the customer (kept up to date) so the list can search and filter in the database
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    channels: [{ type: String, enum: CONSENT_CHANNELS }], // channels the customer may be messaged on
    canMessage: { type: Boolean, default: false },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true }, // the last day of the month, 23:59:59.999 at the issuing branch
    status: { type: String, enum: OFFER_STATUSES, default: 'ISSUED' },
    superseded: { type: Boolean, default: false }, // replaced after a date correction: no longer counts for "one per year"
    invoiceId: ref('Invoice', { default: null }),
    discountGiven: money({ default: null }),
    revokedReason: { type: String, default: null },
    appointmentIds: [ref('Appointment')],
    issuedAt: { type: Date, required: true },
    task: { type: taskSchema, default: () => ({}) },
  },
  { timestamps: true, collection: 'offer_issues' }
);

// Never two offers for the same customer, occasion and year (a replaced one doesn't count)
offerIssueSchema.index({ orgId: 1, customerId: 1, type: 1, year: 1 }, { unique: true, partialFilterExpression: { superseded: false }, name: 'one_offer_per_year' });
// The occasion list: one branch, one month, by name
offerIssueSchema.index({ orgId: 1, homeBranchId: 1, year: 1, month: 1, customerName: 1, _id: 1 });
offerIssueSchema.index({ orgId: 1, status: 1, validUntil: 1 }); // expiry
offerIssueSchema.index({ orgId: 1, campaignId: 1, year: 1, status: 1 }); // emergency withdraw

export default mongoose.model('OfferIssue', offerIssueSchema);
