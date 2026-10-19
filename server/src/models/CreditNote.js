import mongoose from 'mongoose';
import { appendOnly, ref, money } from './fields.js';

// A GST credit note: the tax document for a refund on a GST bill. Its own number series per branch and
// financial year (CN-AND/26-27/001). Never changed once written.
const creditNoteLineSchema = new mongoose.Schema(
  {
    name: String,
    code: String, // SAC (services) or HSN (products)
    qty: Number,
    taxableAmount: money(),
    taxRateBps: Number,
    cgst: money(),
    sgst: money(),
    amount: money(),
  },
  { _id: false }
);

const creditNoteSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    invoiceId: ref('Invoice', { required: true }),
    invoiceNumber: { type: String, required: true },
    invoiceDate: Date,
    refundId: ref('Refund', { required: true }),
    number: { type: String, required: true },
    financialYear: String,
    issuedAt: { type: Date, required: true },
    reason: String,
    lines: [creditNoteLineSchema],
    taxableTotal: money(),
    cgstTotal: money(),
    sgstTotal: money(),
    total: money(),
    seller: { legalName: String, tradeName: String, branchName: String, address: String, gstin: String, stateCode: String, stateName: String },
    customerSnapshot: { name: String, phone: String },
    createdBy: ref('User'),
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'credit_notes' }
);

creditNoteSchema.index({ orgId: 1, number: 1 }, { unique: true });
creditNoteSchema.index({ refundId: 1 }, { unique: true });
appendOnly(creditNoteSchema, 'A credit note');

export default mongoose.model('CreditNote', creditNoteSchema);
