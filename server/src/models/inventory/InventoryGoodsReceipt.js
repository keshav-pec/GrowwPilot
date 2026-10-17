import mongoose from 'mongoose';
import { appendOnly, money, ref } from '../fields.js';
import { wholeNumber } from './wholeNumber.js';

// A delivery that arrived (RECEIPT: against an order or direct) or stock sent back (RETURN).
// Only what physically arrived is recorded. Never changed afterwards.
const receiptLineSchema = new mongoose.Schema(
  {
    poLineId: { type: mongoose.Schema.Types.ObjectId, default: null },
    skuId: ref('InventorySku', { required: true }),
    skuName: String,
    qty: wholeNumber({ min: 1, required: true }), // counting units
    unitCost: money({ default: null }), // per stock unit, in paise
    batch: String,
    expiryDate: String, // YYYY-MM-DD
  },
  { _id: false }
);

const inventoryGoodsReceiptSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    kind: { type: String, enum: ['RECEIPT', 'RETURN'], default: 'RECEIPT' },
    poId: ref('InventoryPurchaseOrder', { default: null }),
    poNumber: String,
    supplierId: ref('InventorySupplier', { default: null }),
    supplierName: String,
    invoiceNumber: String, // the supplier's invoice / delivery note
    locationId: ref('InventoryLocation'),
    lines: [receiptLineSchema],
    overReceipt: { reason: String, approvedBy: { id: ref('User'), name: String } }, // more than was ordered
    reason: String, // returns: why it went back
    transactionId: ref('InventoryTransaction'),
    by: { id: ref('User'), name: String },
    at: { type: Date, default: Date.now },
  },
  { collection: 'inventory_goods_receipts' }
);

inventoryGoodsReceiptSchema.index({ orgId: 1, branchId: 1, at: -1 });
inventoryGoodsReceiptSchema.index({ orgId: 1, poId: 1 });
appendOnly(inventoryGoodsReceiptSchema, 'A delivery record');

export default mongoose.model('InventoryGoodsReceipt', inventoryGoodsReceiptSchema);
