import mongoose from 'mongoose';
import { ref } from './fields.js';
import { GST_RATES_BPS, PREFIX_REGEX } from '../config/billing.js';
import { GST_SCHEMES, GST_SETUP_STATUSES } from '../config/gst.js';

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
    defaultProductTaxBps: { type: Number, enum: GST_RATES_BPS, default: 1800 }, // products without their own rate
    frontDeskDiscountLimitBps: { type: Number, min: 0, max: 10000, default: 1000 }, // 10% of the bill
    guestProductSales: { type: Boolean, default: false }, // product-only bills without a customer ("Guest")
    // What branch owners may do at their branches (the business owner always may)
    branchOwners: {
      approveRefunds: { type: Boolean, default: true },
      voidBills: { type: Boolean, default: true },
      editSettings: { type: Boolean, default: false }, // only their own branches' bill prefix
      viewGst: { type: Boolean, default: false }, // the GST overview and sales register, for their own branches
    },
    // What the front desk may do besides billing and taking payments
    frontDesk: {
      closeCash: { type: Boolean, default: true }, // count the drawer and close the cash day
    },
    branches: [branchBillingSchema],
    // GST setup (modules/gst). Until it is ACTIVE, bills use the fields above exactly as before.
    gst: {
      scheme: { type: String, enum: [...GST_SCHEMES, null], default: null }, // empty = not chosen yet
      status: { type: String, enum: GST_SETUP_STATUSES, default: 'NOT_ACTIVE' },
      startMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // the first month returns come from the app
      testBillAt: Date, // when the owner last tried a sample bill that worked
      activatedAt: Date,
      activatedBy: ref('User'),
      activatedByName: String,
      recordFrom: Date, // bills from here on get their tax entry as they are issued; earlier ones are added once
    },
  },
  { timestamps: true, collection: 'billing_settings' }
);

billingSettingsSchema.index({ orgId: 1 }, { unique: true });

export default mongoose.model('BillingSettings', billingSettingsSchema);
