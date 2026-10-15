import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { RECIPIENT_KINDS } from '../../config/inventory.js';
import { wholeNumber } from './wholeNumber.js';

// A hand-out: stock issued from the store to the floor, a station or a stylist ("In use").
// Its stock sits in the branch's In use place; remainingQty is how much of it is still there.
// Its history (issued, finished, returned, moved...) is in InventoryAllocationEvent.
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
    replacesId: ref('InventoryAllocation', { default: null }), // issued to replace a finished one
    closedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'inventory_allocations' }
);

inventoryAllocationSchema.index({ orgId: 1, branchId: 1, status: 1 });
inventoryAllocationSchema.index({ orgId: 1, skuId: 1, status: 1 });

export default mongoose.model('InventoryAllocation', inventoryAllocationSchema);
