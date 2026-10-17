import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { wholeNumber } from './wholeNumber.js';

// A stock count: what the records said at the start (expected) and what was counted, store and in use
// separately. Approved differences are posted as count-correction movements, never by overwriting a balance.
const countLineSchema = new mongoose.Schema({
  skuId: ref('InventorySku', { required: true }),
  skuName: String,
  place: { type: String, enum: ['STORE', 'HANDOUT'], required: true },
  locationId: ref('InventoryLocation', { default: null }), // a store
  locationName: String,
  allocationId: ref('InventoryAllocation', { default: null }), // a hand-out in use
  heldBy: String,
  expected: wholeNumber({ required: true }),
  counted: wholeNumber({ default: null }), // null = not counted (no change)
  reason: { type: String, trim: true }, // why it is different
});

const personSchema = new mongoose.Schema({ id: ref('User'), name: String }, { _id: false });

const inventoryStockCountSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    status: { type: String, enum: ['COUNTING', 'SUBMITTED', 'APPROVED', 'CANCELLED'], default: 'COUNTING' },
    cutoffAt: { type: Date, required: true }, // when "expected" was taken from the records
    lines: [countLineSchema],
    startedBy: personSchema,
    countedBy: { type: personSchema, default: null },
    submittedAt: Date,
    reviewedBy: { type: personSchema, default: null },
    reviewedAt: Date,
    reviewNote: String,
    transactionIds: [ref('InventoryTransaction')],
  },
  { timestamps: true, collection: 'inventory_stock_counts' }
);

// At most one count in progress per branch
inventoryStockCountSchema.index({ orgId: 1, branchId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['COUNTING', 'SUBMITTED'] } } });

export default mongoose.model('InventoryStockCount', inventoryStockCountSchema);
