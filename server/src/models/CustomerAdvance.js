import mongoose from 'mongoose';
import { ref, money } from './fields.js';

// Money a customer paid ahead, to be used on later bills at any branch of the salon.
// `remaining` only ever goes down with a guarded update, so an advance can never be used twice.
const customerAdvanceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }), // where it was taken
    customerId: ref('Customer', { required: true }),
    amount: money({ required: true, min: 1 }),
    remaining: money({ required: true }),
    // The payments it came from (one, or the extra part of a checkout payment)
    sources: [{ paymentId: ref('Payment'), amount: money(), _id: false }],
    fromInvoiceId: ref('Invoice', { default: null }), // set when it was the extra money paid at a checkout
    note: { type: String, trim: true },
    createdBy: ref('User'),

    // "For named services": taxed when the money came in, with a numbered receipt voucher. Plain advances have none of this.
    taxed: { type: Boolean, default: false },
    receiptNumber: String, // RV-AND/26-27/001
    financialYear: String,
    forServices: [{ serviceId: ref('Service'), name: String, _id: false }],
    gst: {
      taxRuleId: ref('GstTaxRule'),
      taxRuleName: String,
      code: String,
      rateBps: Number,
      itcType: String,
      taxDate: String,
      gstin: String,
      legalName: String,
      tradeName: String,
      branchName: String,
      address: String,
      stateCode: String,
      stateName: String,
      placeOfSupply: { stateCode: String, stateName: String },
      customerName: String,
      phone: String,
      buyer: { gstin: String, legalName: String },
      taxable: money(),
      cgst: money(),
      sgst: money(),
      igst: money(),
      // What is not used yet. Only ever goes down, so the tax used can't exceed the tax paid.
      leftTaxable: money(),
      leftCgst: money(),
      leftSgst: money(),
      leftIgst: money(),
    },
    // Unused money given back to the customer
    givenBack: money({ default: 0 }),
    refunds: [
      {
        number: String, // RF-AND/26-27/001, on taxed advances
        amount: money(),
        paymentId: ref('Payment'),
        method: String,
        reference: String,
        reason: String,
        at: Date,
        byName: String,
        taxable: money({ default: 0 }),
        cgst: money({ default: 0 }),
        sgst: money({ default: 0 }),
        igst: money({ default: 0 }),
        _id: false,
      },
    ],
    reversedAt: Date, // the payment it came from was recorded by mistake
  },
  { timestamps: true, collection: 'customer_advances' }
);

customerAdvanceSchema.index({ orgId: 1, customerId: 1, createdAt: 1 });
customerAdvanceSchema.index({ orgId: 1, taxed: 1, createdAt: -1 });

export default mongoose.model('CustomerAdvance', customerAdvanceSchema);
