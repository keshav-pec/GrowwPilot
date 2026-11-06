import mongoose from 'mongoose';
import { ref } from './fields.js';

// The latest nightly check of one salon: bills, credit notes and voids compared with the tax record.
const differenceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // the same problem keeps the same key from night to night
    code: { type: String, required: true },
    message: { type: String, required: true },
    invoiceId: ref('Invoice'),
    branchId: ref('Branch'),
    link: String,
  },
  { _id: false }
);

const gstCheckSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    ranOn: String, // "YYYY-MM-DD": the night it last ran, so a salon runs once a night
    ranAt: Date,
    checked: { type: Number, default: 0 }, // documents compared
    differences: [differenceSchema],
  },
  { collection: 'gst_checks' }
);

gstCheckSchema.index({ orgId: 1 }, { unique: true });

export default mongoose.model('GstCheck', gstCheckSchema);
