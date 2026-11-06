import mongoose from 'mongoose';
import { ref } from './fields.js';
import { ADJUSTMENT_ROUTES, ADJUSTMENT_STATUSES } from '../config/gst.js';

// A correction to a month already filed. The filed revision is never touched.
const gstAdjustmentSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    returnId: ref('GstReturn', { required: true }),
    gstin: { type: String, required: true },
    period: { type: String, required: true },
    route: { type: String, enum: ADJUSTMENT_ROUTES, required: true },
    status: { type: String, enum: ADJUSTMENT_STATUSES, required: true },
    reason: { type: String, required: true, trim: true },
    invoiceId: ref('Invoice'),
    entryIds: [{ type: mongoose.Schema.Types.ObjectId }], // what was left out of the filed return
    tables: { type: mongoose.Schema.Types.Mixed },
    totals: { type: mongoose.Schema.Types.Mixed },
    issues: [{ severity: String, code: String, message: String, link: String, _id: false }],
    json: { type: mongoose.Schema.Types.Mixed },
    filing: { arn: String, filedOn: String, proofFileId: mongoose.Schema.Types.ObjectId, proofName: String, recordedByName: String, recordedAt: Date },
    createdByName: String,
  },
  { timestamps: true, collection: 'gst_adjustments' }
);

gstAdjustmentSchema.index({ orgId: 1, gstin: 1, period: 1 });

export default mongoose.model('GstAdjustment', gstAdjustmentSchema);
