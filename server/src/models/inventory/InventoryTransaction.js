import mongoose from 'mongoose';
import { appendOnly, ref } from '../fields.js';
import { MOVEMENT_TYPES, RECIPIENT_KINDS } from '../../config/inventory.js';

// One stock action (the header). Its signed lines are in InventoryLedgerEntry. Never changed or deleted:
// a mistake is fixed by a new movement that points at this one (correctsId).
const inventoryTransactionSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    reason: { type: String, trim: true }, // e.g. DAMAGE, EXPIRY (write-offs)
    note: { type: String, trim: true },

    // Who did it (reported it) ...
    actorId: ref('User', { required: true }),
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true }, // "Business owner", "Inventory"...
    // ... and who had the product, which can be someone else
    heldBy: {
      kind: { type: String, enum: [...RECIPIENT_KINDS, null], default: null },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: String,
    },

    reference: { kind: String, id: mongoose.Schema.Types.ObjectId }, // e.g. { kind: 'appointment', id }
    correctsId: ref('InventoryTransaction', { default: null }),
    requestKey: String, // the Idempotency-Key of the request that made it
    occurredAt: { type: Date, required: true }, // when it happened
    postedAt: { type: Date, required: true }, // when it was saved
  },
  { collection: 'inventory_transactions' }
);

inventoryTransactionSchema.index({ orgId: 1, branchId: 1, postedAt: -1 });
appendOnly(inventoryTransactionSchema, 'A stock movement');

export default mongoose.model('InventoryTransaction', inventoryTransactionSchema);
