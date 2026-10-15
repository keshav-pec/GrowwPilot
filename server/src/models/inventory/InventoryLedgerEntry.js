import mongoose from 'mongoose';
import { appendOnly, ref } from '../fields.js';
import { LEDGER_BUCKETS } from '../../config/inventory.js';

// One signed line of a stock movement: +10 into Main store, -1 out of In use...
// Adding up every line for a place gives its balance. Never changed or deleted.
const inventoryLedgerEntrySchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    transactionId: ref('InventoryTransaction', { required: true }),
    skuId: ref('InventorySku', { required: true }),
    locationId: ref('InventoryLocation', { required: true }),
    qty: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'qty must be a whole number other than 0' },
    },
    unitCost: { type: Number, min: 0, default: null }, // paise per counting unit at that moment (null = not known)
    bucket: { type: String, enum: LEDGER_BUCKETS, required: true },
    occurredAt: { type: Date, required: true },
    postedAt: { type: Date, required: true },
  },
  { collection: 'inventory_ledger_entries' }
);

inventoryLedgerEntrySchema.index({ orgId: 1, skuId: 1, branchId: 1, postedAt: -1 });
inventoryLedgerEntrySchema.index({ orgId: 1, locationId: 1, skuId: 1 });
inventoryLedgerEntrySchema.index({ transactionId: 1 });
appendOnly(inventoryLedgerEntrySchema, 'A stock movement line');

export default mongoose.model('InventoryLedgerEntry', inventoryLedgerEntrySchema);
