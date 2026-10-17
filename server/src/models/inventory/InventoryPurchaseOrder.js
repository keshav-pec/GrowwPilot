import mongoose from 'mongoose';
import { money, ref } from '../fields.js';
import { wholeNumber } from './wholeNumber.js';

export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELED'];
// Orders whose not-yet-received quantities count as "on order" (for reorder suggestions, AC30)
export const OPEN_PO_STATUSES = ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'];

const poLineSchema = new mongoose.Schema({
  skuId: ref('InventorySku', { required: true }),
  skuName: String,
  qty: wholeNumber({ min: 1, required: true }), // ordered, in the product's counting unit
  unitCost: money({ default: null }), // price per stock unit (per bottle), in paise; null = not known
  receivedQty: wholeNumber({ default: 0 }),
});

const personSchema = new mongoose.Schema({ id: ref('User'), name: String }, { _id: false });

// A purchase order for one branch from one supplier.
// DRAFT -> PENDING_APPROVAL (when needed) -> APPROVED -> ORDERED -> PARTIALLY_RECEIVED / RECEIVED -> CLOSED, or CANCELED
const inventoryPurchaseOrderSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    number: { type: String, required: true }, // PO-AND-000045
    supplierId: ref('InventorySupplier', { required: true }),
    supplierName: String,
    status: { type: String, enum: PO_STATUSES, default: 'DRAFT' },
    lines: [poLineSchema],
    total: { type: Number, default: null }, // paise; null when some prices are missing
    expectedDate: { type: String, default: null }, // YYYY-MM-DD
    note: { type: String, trim: true },
    createdBy: personSchema,
    submittedAt: Date,
    approvedBy: { type: personSchema, default: null },
    approvedAt: Date,
    decisionNote: String,
    orderedAt: Date,
    closedAt: Date,
    cancelledAt: Date,
    version: { type: Number, default: 1 },
  },
  { timestamps: true, collection: 'inventory_purchase_orders' }
);

inventoryPurchaseOrderSchema.index({ orgId: 1, number: 1 }, { unique: true });
inventoryPurchaseOrderSchema.index({ orgId: 1, branchId: 1, status: 1, createdAt: -1 });

export default mongoose.model('InventoryPurchaseOrder', inventoryPurchaseOrderSchema);
