import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { PURCHASE_USES } from '../config/gst.js';

// A supplier's bill to the salon: the books side of Purchases & ITC. Works with or without the Inventory add-on.
const gstPurchaseBillSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    gstin: { type: String, required: true }, // the salon's GSTIN it was billed to
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // the month whose GSTR-2B and GSTR-3B it belongs to
    supplierId: ref('InventorySupplier', { default: null }),
    supplierName: { type: String, required: true, trim: true },
    supplierGstin: { type: String, required: true, uppercase: true, trim: true },
    billNumber: { type: String, required: true, trim: true },
    matchKey: { type: String, required: true }, // supplier GSTIN + the number without spaces, dashes or leading zeros
    billDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    taxable: money({ required: true }),
    igst: money({ default: 0 }),
    cgst: money({ default: 0 }),
    sgst: money({ default: 0 }),
    use: { type: String, enum: PURCHASE_USES, required: true },
    receiptId: ref('InventoryGoodsReceipt', { default: null }), // the delivery it came with, if any
    note: { type: String, trim: true },
    decisionId: ref('GstItcDecision', { default: null }), // the decision that stands
    cancelled: { reason: String, at: Date, byName: String },
    createdBy: ref('User'),
    createdByName: String,
  },
  { timestamps: true, collection: 'gst_purchase_bills' }
);

gstPurchaseBillSchema.index({ orgId: 1, gstin: 1, period: 1 });
gstPurchaseBillSchema.index({ orgId: 1, matchKey: 1 });

export default mongoose.model('GstPurchaseBill', gstPurchaseBillSchema);
