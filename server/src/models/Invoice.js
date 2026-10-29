import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { APPROVAL_STATUSES, DISCOUNT_TYPES, INVOICE_STATUSES, LINE_KINDS, REFUND_STATUSES, SETTLEMENT_STATUSES } from '../config/billing.js';

// One line of a bill. Names, prices and tax are a snapshot: the bill never changes when a service,
// a stylist or the GST settings change later. Amounts are worked out by billing/tax.rules.js.
const lineSchema = new mongoose.Schema({
  kind: { type: String, enum: LINE_KINDS, default: 'SERVICE' },
  itemId: { type: mongoose.Schema.Types.ObjectId, default: null }, // the service inside the appointment
  skuId: ref('InventorySku', { default: null }), // a product sold (Inventory add-on)
  hsnCode: String, // products: GST goods code
  serviceId: ref('Service', { default: null }),
  staffId: ref('Staff', { default: null }),
  staffName: String,
  name: { type: String, required: true },
  sacCode: String,
  qty: { type: Number, default: 1, min: 1 },
  listUnitPrice: money({ required: true }), // the price when the bill was opened
  unitPrice: money({ required: true }), // the price charged (an owner may change it, with a reason)
  priceChangeReason: String,
  listComboDiscount: money({ default: 0 }), // this line's part of a combo's lower price, at the list price
  comboDiscount: money({ default: 0 }), // the combo part that applies (none once an owner sets the price)
  occasionDiscount: money({ default: 0 }), // this line's part of a birthday / anniversary offer
  discountType: { type: String, enum: DISCOUNT_TYPES, default: 'flat' },
  discountValue: { type: Number, min: 0, default: 0 }, // flat: paise · percent: 0 to 100
  lineDiscount: money({ default: 0 }),
  billDiscountShare: money({ default: 0 }), // this line's part of the whole-bill discount
  taxableAmount: money({ default: 0 }), // after every discount, without GST
  taxRateBps: { type: Number, min: 0, default: 0 },
  cgst: money({ default: 0 }),
  sgst: money({ default: 0 }),
  lineTotal: money({ default: 0 }), // what the customer pays for this line
  // Refunds so far (credit notes): how many units, and how much of each amount was taken back
  refundedQty: { type: Number, min: 0, default: 0 },
  creditedTaxable: money({ default: 0 }),
  creditedCgst: money({ default: 0 }),
  creditedSgst: money({ default: 0 }),
  creditedAmount: money({ default: 0 }),
});

const taxRowSchema = new mongoose.Schema(
  { rateBps: Number, taxableAmount: money(), cgst: money(), sgst: money() },
  { _id: false }
);

// A birthday / anniversary offer on the bill (one per bill). Used up only when the bill is issued.
const offerSchema = new mongoose.Schema(
  {
    offerIssueId: ref('OfferIssue', { required: true }),
    type: String, // BIRTHDAY | ANNIVERSARY
    campaignName: String,
    rules: { type: mongoose.Schema.Types.Mixed }, // the offer's frozen terms
    eligibleSubtotal: money({ default: 0 }), // what the eligible services cost, before GST
    discount: money({ default: 0 }),
    eligible: { type: Boolean, default: true }, // false: the bill no longer qualifies (e.g. a service was made cheaper)
    code: String, // why not: NO_ELIGIBLE_SERVICE | MIN_SPEND
    shortBy: money({ default: null }),
  },
  { _id: false }
);

// A discount above the front desk limit waits for an owner
const approvalSchema = new mongoose.Schema(
  {
    status: { type: String, enum: APPROVAL_STATUSES, default: 'NONE' },
    requestedBy: ref('User'),
    requestedByName: String,
    requestedAt: Date,
    requestedDiscount: money(), // the discount the request was for
    note: String, // why the front desk asked
    decidedBy: ref('User'),
    decidedByName: String,
    decidedAt: Date,
    decisionNote: String,
    approvedDiscount: money(), // the most the bill may now be discounted without asking again
  },
  { _id: false }
);

// A bill. It starts as a DRAFT (can be changed, has no number), becomes ISSUED (gets its number, is locked)
// and is paid in one go or in parts. Payments live in their own collection (Payment + PaymentAllocation).
const invoiceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    // Set while the bill counts for this appointment. A voided bill (Phase 2) moves it to voidedAppointmentId,
    // so the appointment can be billed again; the partial unique index below needs this.
    appointmentId: ref('Appointment', { default: undefined }),
    voidedAppointmentId: ref('Appointment', { default: undefined }),
    customerId: ref('Customer', { default: null }), // empty only for guest product sales (Phase 2)

    status: { type: String, enum: INVOICE_STATUSES, default: 'DRAFT' },
    settlementStatus: { type: String, enum: SETTLEMENT_STATUSES, default: 'UNPAID' },
    refundStatus: { type: String, enum: REFUND_STATUSES, default: 'NONE' },
    invoiceNumber: { type: String, default: undefined }, // given at issue: AND/26-27/00001 (old bills: GP-AND-000123)
    financialYear: String, // "26-27"

    lines: [lineSchema],
    billDiscountType: { type: String, enum: DISCOUNT_TYPES, default: 'flat' },
    billDiscountValue: { type: Number, min: 0, default: 0 },

    // How tax was worked out (a snapshot of the salon's settings)
    gstRegistered: { type: Boolean, default: false },
    pricesIncludeTax: { type: Boolean, default: true },

    subtotal: money({ default: 0 }), // list prices x qty
    comboDiscountTotal: money({ default: 0 }),
    manualDiscount: money({ default: 0 }), // line + bill discounts a person gave
    occasionDiscountTotal: money({ default: 0 }), // a birthday / anniversary offer (not counted in manualDiscount)
    offer: { type: offerSchema, default: null },
    discountTotal: money({ default: 0 }), // combo + occasion offer + manual
    taxableTotal: money({ default: 0 }),
    cgstTotal: money({ default: 0 }),
    sgstTotal: money({ default: 0 }),
    taxTotal: money({ default: 0 }),
    grandTotal: money({ default: 0 }),
    amountPaid: money({ default: 0 }), // money put on this bill (payments and advances), less reversed payments
    creditedTotal: money({ default: 0 }), // value taken off the bill by refunds (credit notes)
    refundedTotal: money({ default: 0 }), // money handed back to the customer
    // still owed = (grandTotal - creditedTotal) - (amountPaid - refundedTotal), never below 0
    balanceDue: money({ default: 0 }),
    taxSummary: [taxRowSchema],

    // Who sold and who bought, as printed on the bill
    seller: {
      legalName: String,
      tradeName: String,
      branchName: String,
      address: String,
      gstin: String,
      stateCode: String,
      stateName: String,
    },
    customerSnapshot: { name: String, phone: String },

    approval: { type: approvalSchema, default: () => ({}) },
    notes: { type: String, trim: true },

    issuedAt: Date,
    issuedBy: ref('User'),
    paidAt: Date, // when it became fully paid (commission is earned then)
    voidedAt: Date,
    voidedBy: ref('User'),
    voidReason: String,
    createdBy: ref('User'),
    version: { type: Number, default: 0 }, // goes up on every change; a stale edit is refused
  },
  { timestamps: true }
);

// One live bill per appointment (drafts and issued bills; never a second checkout)
invoiceSchema.index({ appointmentId: 1 }, { name: 'one_bill_per_appointment', unique: true, partialFilterExpression: { appointmentId: { $type: 'objectId' } } });
// Bill numbers never repeat in a salon (drafts have none yet)
invoiceSchema.index({ orgId: 1, invoiceNumber: 1 }, { name: 'invoice_number_unique', unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } });
invoiceSchema.index({ orgId: 1, branchId: 1, issuedAt: -1 }); // bills list and revenue
invoiceSchema.index({ orgId: 1, branchId: 1, balanceDue: 1 }); // bills with dues
invoiceSchema.index({ orgId: 1, customerId: 1 }); // customer spend
invoiceSchema.index({ orgId: 1, paidAt: 1 }); // commission on fully paid bills

export default mongoose.model('Invoice', invoiceSchema);
