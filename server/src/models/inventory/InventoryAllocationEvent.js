import mongoose from 'mongoose';
import { appendOnly, ref } from '../fields.js';
import { RECIPIENT_KINDS } from '../../config/inventory.js';

const recipientSchema = new mongoose.Schema(
  { kind: { type: String, enum: RECIPIENT_KINDS }, id: mongoose.Schema.Types.ObjectId, name: String },
  { _id: false }
);

// The history of one hand-out: issued, finished, returned, moved, written off, corrected, flagged for handover.
// Never changed or deleted.
const inventoryAllocationEventSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    allocationId: ref('InventoryAllocation', { required: true }),
    type: { type: String, enum: ['ISSUED', 'FINISHED', 'RETURNED', 'MOVED', 'WRITTEN_OFF', 'CORRECTED', 'HANDOVER_NEEDED'], required: true },
    qty: { type: Number, default: 0 },
    from: { type: recipientSchema, default: null },
    to: { type: recipientSchema, default: null },
    transactionId: ref('InventoryTransaction', { default: null }),
    actorId: ref('User'),
    actorName: String,
    note: String,
    at: { type: Date, default: Date.now },
  },
  { collection: 'inventory_allocation_events' }
);

inventoryAllocationEventSchema.index({ orgId: 1, allocationId: 1, at: 1 });
appendOnly(inventoryAllocationEventSchema, 'A hand-out history row');

export default mongoose.model('InventoryAllocationEvent', inventoryAllocationEventSchema);
