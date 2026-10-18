import mongoose from 'mongoose';
import { ref } from './fields.js';
import { GST_RATES_BPS, PREFIX_REGEX } from '../config/billing.js';

// Each branch's GST details and bill prefix. A branch without a row uses the defaults (see billing/settings.service.js).
const branchBillingSchema = new mongoose.Schema(
  {
    branchId: ref('Branch', { required: true }),
    gstin: { type: String, trim: true, uppercase: true, default: null }, // e.g. 27AAACG1234A1Z5
    stateCode: { type: String, match: /^\d{2}$/, default: null }, // GST state code, e.g. "27" = Maharashtra
    invoicePrefix: { type: String, match: PREFIX_REGEX, default: null }, // e.g. "AND"; empty = from the branch name
  },
  { _id: false }
);

// The salon's billing rules: one row per salon. A salon nobody has set up yet gets the defaults below
// (not GST registered, so bills stay exactly as they were before GST existed in the app).
const billingSettingsSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    legalName: { type: String, trim: true, default: '' }, // printed on GST bills; empty = the salon name
    gstRegistered: { type: Boolean, default: false },
    pricesIncludeTax: { type: Boolean, default: true }, // true: ₹1,180 on the menu is what the customer pays
    defaultServiceTaxBps: { type: Number, enum: GST_RATES_BPS, default: 1800 }, // services without their own rate
    defaultSacCode: { type: String, trim: true, default: '' }, // services without their own SAC code
    frontDeskDiscountLimitBps: { type: Number, min: 0, max: 10000, default: 1000 }, // 10% of the bill
    guestProductSales: { type: Boolean, default: false }, // product-only bills without a customer (Phase 2)
    branches: [branchBillingSchema],
  },
  { timestamps: true, collection: 'billing_settings' }
);

billingSettingsSchema.index({ orgId: 1 }, { unique: true });

export default mongoose.model('BillingSettings', billingSettingsSchema);
