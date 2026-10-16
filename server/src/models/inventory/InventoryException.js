import mongoose from 'mongoose';
import { ref } from '../fields.js';

// An automatic use that couldn't be posted (not enough stock, product not stocked at the branch...).
// Nothing goes below zero; it waits here until someone posts it (after restocking) or an owner dismisses it.
// Keeps the recipe amount it would have used, so a later recipe change doesn't alter it.
const inventoryExceptionSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    key: { type: String, required: true }, // the same key the automatic use would have had
    appointmentId: ref('Appointment'),
    serviceLineId: mongoose.Schema.Types.ObjectId,
    serviceId: ref('Service'),
    serviceName: String,
    staffId: ref('Staff'),
    staffName: String,
    recipeId: ref('InventoryRecipe'),
    recipeVersion: Number,
    recipeLineId: mongoose.Schema.Types.ObjectId,
    skuId: ref('InventorySku'),
    skuName: String,
    qty: Number,
    useStoreIfNeeded: Boolean,
    completedAt: Date,
    reason: { type: String, enum: ['NOT_ENOUGH_STOCK', 'NOT_STOCKED_HERE', 'PRODUCT_INACTIVE', 'NO_OPEN_HANDOUT'] },
    message: String,
    status: { type: String, enum: ['OPEN', 'POSTED', 'DISMISSED'], default: 'OPEN' },
    resolvedBy: { id: ref('User'), name: String },
    resolvedAt: Date,
    note: String,
    transactionId: ref('InventoryTransaction', { default: null }),
  },
  { timestamps: true, collection: 'inventory_exceptions' }
);

inventoryExceptionSchema.index({ orgId: 1, key: 1 }, { unique: true });
inventoryExceptionSchema.index({ orgId: 1, branchId: 1, status: 1, createdAt: -1 });

export default mongoose.model('InventoryException', inventoryExceptionSchema);
