import mongoose from 'mongoose';
import { ref } from './fields.js';
import { LINE_KINDS, GST_RATES_BPS } from '../config/billing.js';
import { ITC_TYPES, TAX_RULE_STATUSES } from '../config/gst.js';

// A tax rule for a period: a name, a SAC or HSN code, a rate and whether input tax credit applies.
// A change of rate is a new row in the same group, so services and products keep pointing at the group
// and each bill picks the row that applies on its date.
const gstTaxRuleSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    groupId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: LINE_KINDS, required: true }, // SERVICE (SAC code) or PRODUCT (HSN code)
    code: { type: String, required: true, trim: true },
    rateBps: { type: Number, enum: GST_RATES_BPS, required: true },
    itcType: { type: String, enum: ITC_TYPES, required: true },
    from: { type: String, required: true }, // "YYYY-MM-DD"
    to: { type: String, default: null }, // no end date = until a newer rule takes over
    status: { type: String, enum: TAX_RULE_STATUSES, default: 'DRAFT' },
    reviewedBy: { type: String, trim: true }, // who checked it, e.g. the salon's GST practitioner
    approvedBy: ref('User'),
    approvedByName: String,
    approvedAt: Date,
    createdBy: ref('User'),
  },
  { timestamps: true, collection: 'gst_tax_rules' }
);

gstTaxRuleSchema.index({ orgId: 1, groupId: 1, from: 1 });

export default mongoose.model('GstTaxRule', gstTaxRuleSchema);
