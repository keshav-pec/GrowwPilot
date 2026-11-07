import mongoose from 'mongoose';
import { ref } from './fields.js';
import { WORKSHEET_STATUSES } from '../config/gst.js';

// One revision of a GSTR-3B working sheet. Our figures and the portal's are kept apart, and neither overwrites the other.
// It works out tax, not what was paid: paying and filing happen on the portal.
const gstWorksheetSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    gstin: { type: String, required: true },
    legalName: String,
    period: { type: String, required: true },
    revision: { type: Number, required: true },
    status: { type: String, enum: WORKSHEET_STATUSES, default: 'DRAFT' },
    superseded: { type: Boolean, default: false },
    cutoffAt: Date,
    mapping: { type: mongoose.Schema.Types.Mixed }, // which table rows this month uses
    rows: { type: mongoose.Schema.Types.Mixed }, // [{ key, table, label, taxable, igst, cgst, sgst, entryIds?, decisionIds? }]
    summary: { type: mongoose.Schema.Types.Mixed },
    notes: [{ severity: String, code: String, message: String, link: String, _id: false }],
    sourceHash: String,
    // Typed in from the portal, never used in place of ours
    portal: { rows: { type: mongoose.Schema.Types.Mixed }, enteredByName: String, enteredAt: Date },
    approvedByName: String,
    approvedAt: Date,
    differenceNote: String, // why it was approved with differences
    filing: { arn: String, filedOn: String, confirmation: String, proofFileId: mongoose.Schema.Types.ObjectId, proofName: String, recordedByName: String, recordedAt: Date },
    preparedByName: String,
  },
  { timestamps: true, collection: 'gst_worksheets' }
);

gstWorksheetSchema.index({ orgId: 1, gstin: 1, period: 1, revision: 1 }, { unique: true });
gstWorksheetSchema.index({ orgId: 1, gstin: 1, period: 1 }, { name: 'one_filed_sheet_per_month', unique: true, partialFilterExpression: { status: 'FILED' } });

export default mongoose.model('GstWorksheet', gstWorksheetSchema);
