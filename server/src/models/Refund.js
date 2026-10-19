import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { PAYMENT_METHODS } from '../config/constants.js';
import { LINE_KINDS, REFUND_REQUEST_STATUSES, RESTOCK_OPTIONS } from '../config/billing.js';

// One line of a refund: how many units of a bill line come back, and (products) whether they can be sold again.
// The amounts are filled in when the refund is done (they are worked out from the bill at that moment).
const refundLineSchema = new mongoose.Schema(
  {
    lineId: { type: mongoose.Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: LINE_KINDS, required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    restock: { type: String, enum: [...RESTOCK_OPTIONS, null], default: null }, // products only
    taxableAmount: money({ default: 0 }),
    taxRateBps: { type: Number, default: 0 },
    cgst: money({ default: 0 }),
    sgst: money({ default: 0 }),
    amount: money({ default: 0 }), // taxable + CGST + SGST
  },
  { _id: false }
);

// A refund or return on an issued bill. The front desk asks (REQUESTED); an owner approves (it is DONE in one
// transaction: credit, money back, stock, commission) or turns it down (REJECTED).
const refundSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    invoiceId: ref('Invoice', { required: true }),
    invoiceNumber: { type: String, required: true },
    customerId: ref('Customer', { default: null }),
    customerName: String,
    status: { type: String, enum: REFUND_REQUEST_STATUSES, default: 'REQUESTED' },
    lines: [refundLineSchema],
    reason: { type: String, required: true, trim: true },
    method: { type: String, enum: PAYMENT_METHODS, default: 'CASH' }, // how the money goes back
    reference: { type: String, trim: true },

    creditTotal: money({ default: 0 }), // value taken off the bill
    cashRefund: money({ default: 0 }), // money handed back (credit beyond what was still owed)
    dueReduced: money({ default: 0 }), // the rest of the credit just lowered what the customer owed
    creditNoteId: ref('CreditNote', { default: null }),
    creditNoteNumber: String,
    refundPaymentId: ref('Payment', { default: null }),

    requestedBy: ref('User'),
    requestedByName: String,
    requestedAt: Date,
    decidedBy: ref('User'),
    decidedByName: String,
    decidedAt: Date,
    decisionNote: String,
  },
  { timestamps: true }
);

refundSchema.index({ orgId: 1, invoiceId: 1 });
// At most one refund waiting for approval per bill
refundSchema.index({ invoiceId: 1 }, { name: 'one_pending_refund_per_bill', unique: true, partialFilterExpression: { status: 'REQUESTED' } });

export default mongoose.model('Refund', refundSchema);
