import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { BASE_UNITS, SKU_TYPES, WAYS_OF_USE } from '../../config/inventory.js';
import { wholeNumber } from './wholeNumber.js';

// A product, for the whole salon. Which branches use it, and their reorder levels and cost,
// are in InventorySkuBranch. How much there is lives in the movement history (and InventoryBalance).
const inventorySkuSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    code: { type: String, required: true, trim: true, uppercase: true }, // SKU-000123 (made automatically), unique per salon
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    brand: { type: String, trim: true },
    barcodes: [{ type: String, trim: true }], // unique within the salon
    type: { type: String, enum: SKU_TYPES, default: 'PROFESSIONAL' },

    stockUnit: { type: String, required: true, trim: true, lowercase: true }, // bottle, jar, kit, piece...
    wayOfUse: { type: String, enum: WAYS_OF_USE, required: true },
    // Measured products only: counted in whole base units, e.g. a 1000 ml bottle -> baseUnit 'ml', unitsPerStockUnit 1000
    baseUnit: { type: String, enum: [...BASE_UNITS, null], default: null },
    unitsPerStockUnit: wholeNumber({ min: 1, default: 1 }),

    // Up to 4 photos, one of them the main one. The files live in the image store (GridFS for now).
    images: [
      {
        fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // 1000 px
        thumbId: { type: mongoose.Schema.Types.ObjectId, required: true }, // 240 px
        isMain: { type: Boolean, default: false },
        width: Number,
        height: Number,
        originalName: String,
        uploadedBy: { id: ref('User'), name: String },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }, // inactive keeps all its history (and photos)
    version: { type: Number, default: 1 }, // goes up on every edit; a stale edit is refused (STALE_VERSION)
    createdBy: ref('User'),
  },
  { timestamps: true, collection: 'inventory_skus' }
);

inventorySkuSchema.index({ orgId: 1, code: 1 }, { unique: true });
// Only products that have a barcode take part (otherwise every product without one would clash)
inventorySkuSchema.index({ orgId: 1, barcodes: 1 }, { unique: true, partialFilterExpression: { 'barcodes.0': { $exists: true } } });
inventorySkuSchema.index({ orgId: 1, name: 1 });

export default mongoose.model('InventorySku', inventorySkuSchema);
