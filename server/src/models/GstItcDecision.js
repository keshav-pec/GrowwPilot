import mongoose from 'mongoose';
import { appendOnly, ref, money } from './fields.js';

const parts = () => ({ igst: money({ default: 0 }), cgst: money({ default: 0 }), sgst: money({ default: 0 }) });

// An owner's decision on a purchase's input tax credit, with a reason. Never changed: changing one's mind is a new row.
// Every rupee claimed traces to one bill and one of these. A match alone never claims anything.
const gstItcDecisionSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    gstin: { type: String, required: true },
    period: { type: String, required: true },
    billId: ref('GstPurchaseBill', { default: null }),
    rowKey: String, // a GSTR-2B row with no bill in the books, decided as not claimed
    documentNumber: String,
    supplierName: String,
    matchStatus: String, // where it stood at that moment
    use: String,
    eligible: parts(),
    notEligible: parts(),
    reason: { type: String, required: true, trim: true },
    decidedBy: ref('User'),
    decidedByName: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'gst_itc_decisions' }
);

gstItcDecisionSchema.index({ orgId: 1, gstin: 1, period: 1, createdAt: 1 });
gstItcDecisionSchema.index({ billId: 1 });
appendOnly(gstItcDecisionSchema, 'An ITC decision');

export default mongoose.model('GstItcDecision', gstItcDecisionSchema);
