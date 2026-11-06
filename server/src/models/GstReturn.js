import mongoose from 'mongoose';
import { ref } from './fields.js';
import { RETURN_STATUSES } from '../config/gst.js';

// One revision of a GSTR-1, for one GSTIN and month. Rebuilding adds a new revision and keeps this one.
// Its figures never change once written: only where it stands (approved, exported, filed...) moves on.
const gstReturnSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    gstin: { type: String, required: true },
    legalName: String,
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    revision: { type: Number, required: true },
    status: { type: String, enum: RETURN_STATUSES, required: true },
    superseded: { type: Boolean, default: false }, // a newer revision exists

    cutoffAt: { type: Date, required: true }, // what the tax record held at this moment
    rules: { type: mongoose.Schema.Types.Mixed }, // the grouping rules of this period
    tables: { type: mongoose.Schema.Types.Mixed }, // in paise
    totals: { type: mongoose.Schema.Types.Mixed },
    lineage: [{ row: String, table: String, entryIds: [{ type: mongoose.Schema.Types.ObjectId }], _id: false }], // each figure back to its entries
    excluded: [{ entryId: mongoose.Schema.Types.ObjectId, documentNumber: String, reason: String, _id: false }],
    issues: [{ severity: String, code: String, message: String, link: String, table: String, documentNumber: String, _id: false }],
    entryCount: Number,
    sourceHash: String, // changes if anything is added to the record for this month

    json: { type: mongoose.Schema.Types.Mixed }, // the file, written when approved
    formatVersion: String,
    preparedBy: ref('User'),
    preparedByName: String,
    approvedBy: ref('User'),
    approvedByName: String,
    approvedAt: Date,
    exports: [{ at: Date, byName: String, _id: false }],
    rejection: { at: Date, byName: String, rows: [{ documentNumber: String, message: String, link: String, _id: false }] },
    filing: { arn: String, filedOn: String, confirmation: String, proofFileId: mongoose.Schema.Types.ObjectId, proofName: String, recordedByName: String, recordedAt: Date },
    gstr3b: { arn: String, filedOn: String, recordedByName: String, recordedAt: Date }, // GSTR-3B of this month: closes the GSTR-1A route
  },
  { timestamps: true, collection: 'gst_returns' }
);

gstReturnSchema.index({ orgId: 1, gstin: 1, period: 1, revision: 1 }, { unique: true });
// A month is filed once
gstReturnSchema.index({ orgId: 1, gstin: 1, period: 1 }, { name: 'one_filed_per_month', unique: true, partialFilterExpression: { status: 'FILED' } });

export default mongoose.model('GstReturn', gstReturnSchema);
