import mongoose from 'mongoose';
import { appendOnly, ref } from './fields.js';
import { TAX_ENTRY_TYPES } from '../config/gst.js';

// Whole paise that can be below zero: a credit note or a void is a minus entry
const signed = () => ({ type: Number, default: 0, validate: { validator: Number.isInteger, message: '{PATH} must be a whole number of paise' } });

const entryLineSchema = new mongoose.Schema(
  {
    lineId: { type: mongoose.Schema.Types.ObjectId },
    kind: String,
    name: String,
    code: String, // SAC or HSN
    qty: Number,
    rateBps: Number,
    taxRuleId: ref('GstTaxRule'),
    itcType: String,
    taxable: signed(),
    cgst: signed(),
    sgst: signed(),
    igst: signed(),
    total: signed(),
  },
  { _id: false }
);

// The permanent tax record: one entry per taxed event, saved in the same transaction as the event itself.
// Never changed. A correction is a new minus entry linked to the original.
const gstTaxEntrySchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    type: { type: String, enum: TAX_ENTRY_TYPES, required: true },
    sourceKey: { type: String, required: true }, // what caused it: "bill:<id>", "creditnote:<refund id>", "void:<id>"
    invoiceId: ref('Invoice', { required: true }),
    refundId: ref('Refund'),
    originalEntryId: ref('GstTaxEntry'), // minus entries: the bill's entry, when the bill is in the record
    documentNumber: { type: String, required: true }, // the bill or credit note number
    invoiceNumber: { type: String, required: true },
    taxDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // in the branch's time
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // the month it counts in
    gstin: { type: String, required: true }, // the salon's GSTIN on the document: returns are per GSTIN
    legalName: String,
    customerName: String,
    buyer: { gstin: String, legalName: String },
    placeOfSupply: { stateCode: String, stateName: String },
    interstate: { type: Boolean, default: false },
    lines: [entryLineSchema],
    taxable: signed(),
    cgst: signed(),
    sgst: signed(),
    igst: signed(),
    tax: signed(),
    total: signed(),
    addedLater: { type: Boolean, default: false }, // an older bill, added when the salon activated
    createdBy: ref('User'),
    createdByName: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'gst_tax_entries' }
);

// One entry per event, however many times it is retried
gstTaxEntrySchema.index({ orgId: 1, sourceKey: 1 }, { unique: true });
gstTaxEntrySchema.index({ orgId: 1, gstin: 1, period: 1, taxDate: -1 });
gstTaxEntrySchema.index({ orgId: 1, branchId: 1, taxDate: 1 });
gstTaxEntrySchema.index({ invoiceId: 1 });
appendOnly(gstTaxEntrySchema, 'A tax entry');

export default mongoose.model('GstTaxEntry', gstTaxEntrySchema);
