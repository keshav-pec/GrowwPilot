import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { wholeNumber } from './wholeNumber.js';

// A product as used at one branch: reorder levels, supplier and the moving average cost.
const inventorySkuBranchSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    skuId: ref('InventorySku', { required: true }),
    active: { type: Boolean, default: true },

    reorderPoint: wholeNumber({ default: null }), // order more when available stock is at or below this
    reorderQty: wholeNumber({ default: null }),
    preferredSupplierId: { type: mongoose.Schema.Types.ObjectId, default: null }, // suppliers come in Phase 6
    leadTimeDays: wholeNumber({ default: null }),

    // Moving average cost in paise per counting unit (per bottle, or per ml for measured products).
    // Can have decimals (₹5 per 1000 ml = 0.5 paise per ml). null = no cost known yet.
    avgCost: { type: Number, min: 0, default: null },
    lowStockAlertAt: { type: Date, default: null }, // alert sent once, cleared when restocked (Phase 4)
  },
  { timestamps: true, collection: 'inventory_sku_branches' }
);

inventorySkuBranchSchema.index({ orgId: 1, branchId: 1, skuId: 1 }, { unique: true });
inventorySkuBranchSchema.index({ orgId: 1, skuId: 1 });

export default mongoose.model('InventorySkuBranch', inventorySkuBranchSchema);
