import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { RECIPIENT_KINDS } from '../../config/inventory.js';
import { wholeNumber } from './wholeNumber.js';

// A hand-out: stock issued from the store to the floor, a station or a stylist ("In use").
// Used from Phase 4 (issue, finish & replace, return, move). Phase 2 only reads it, e.g. to block
// changing a product's way of use while hand-outs are open.
const inventoryAllocationSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    skuId: ref('InventorySku', { required: true }),
    recipient: {
      kind: { type: String, enum: RECIPIENT_KINDS, required: true },
      id: { type: mongoose.Schema.Types.ObjectId, default: null }, // station or staff id (FLOOR has none)
      name: { type: String, required: true },
    },
    issuedQty: wholeNumber({ required: true }),
    remainingQty: wholeNumber({ required: true }),
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    needsHandover: { type: Boolean, default: false }, // the stylist who had it left (Phase 4)
    replacesId: ref('InventoryAllocation', { default: null }),
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'inventory_allocations' }
);

inventoryAllocationSchema.index({ orgId: 1, branchId: 1, status: 1 });
inventoryAllocationSchema.index({ orgId: 1, skuId: 1, status: 1 });

export default mongoose.model('InventoryAllocation', inventoryAllocationSchema);
