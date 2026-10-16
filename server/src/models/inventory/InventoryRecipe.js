import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { wholeNumber } from './wholeNumber.js';

// What a service uses, e.g. Facial = 1 facial kit; Root touch-up = 60 ml colour + 60 ml developer.
// Quantities are always typed in by an owner, never suggested.
const recipeLineSchema = new mongoose.Schema({
  skuId: ref('InventorySku', { required: true }),
  qty: wholeNumber({ min: 1, default: null }), // in the product's counting unit (kits, or ml / g for measured products)
  // false = linked for reports only (e.g. "about 30 washes per shampoo bottle"); finish-mode products are always this
  deducts: { type: Boolean, default: true },
  // Measured products are taken from an open (handed-out) bottle first. If none is open: take from the store?
  useStoreIfNeeded: { type: Boolean, default: true },
});

// One version of a service's recipe, salon-wide (branchId null) or for one branch (the branch recipe wins).
// Changing a recipe adds a new version from a start time and ends the previous one there, so versions never
// overlap and stock already used keeps the version it used (AC23).
const inventoryRecipeSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    serviceId: ref('Service', { required: true }),
    branchId: ref('Branch', { default: null }),
    version: { type: Number, required: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null }, // null = still in use
    lines: [recipeLineSchema],
    note: String,
    createdBy: { id: ref('User'), name: String },
  },
  { timestamps: true, collection: 'inventory_recipes' }
);

inventoryRecipeSchema.index({ orgId: 1, serviceId: 1, branchId: 1, version: 1 }, { unique: true });
inventoryRecipeSchema.index({ orgId: 1, serviceId: 1, branchId: 1, effectiveFrom: 1 });

export default mongoose.model('InventoryRecipe', inventoryRecipeSchema);
