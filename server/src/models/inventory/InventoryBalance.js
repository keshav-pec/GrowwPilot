import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { wholeNumber } from './wholeNumber.js';

// How much of a product is at one place right now. Only the stock engine changes it, and only together
// with a movement, so it can always be rebuilt from the movement history. Never below zero.
const inventoryBalanceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    skuId: ref('InventorySku', { required: true }),
    locationId: ref('InventoryLocation', { required: true }),
    qty: wholeNumber({ required: true, default: 0 }),
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'inventory_balances' }
);

inventoryBalanceSchema.index({ orgId: 1, locationId: 1, skuId: 1 }, { unique: true });
inventoryBalanceSchema.index({ orgId: 1, branchId: 1, skuId: 1 });

export default mongoose.model('InventoryBalance', inventoryBalanceSchema);
