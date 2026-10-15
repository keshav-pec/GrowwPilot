import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { LOCATION_KINDS } from '../../config/inventory.js';

// Where stock is kept at a branch. Every branch gets "Main store" and "In use" automatically.
// Stations ("Chair 3", "Colour bar") receive stock but have no balance of their own: it counts as In use.
const inventoryLocationSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    kind: { type: String, enum: LOCATION_KINDS, required: true },
    name: { type: String, required: true, trim: true },
    isMain: { type: Boolean, default: false }, // the branch's main store (opening stock and deliveries go here)
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'inventory_locations' }
);

// One main store and one In use per branch
inventoryLocationSchema.index({ orgId: 1, branchId: 1, isMain: 1 }, { unique: true, partialFilterExpression: { isMain: true } });
inventoryLocationSchema.index({ orgId: 1, branchId: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: 'IN_USE' } });

export default mongoose.model('InventoryLocation', inventoryLocationSchema);
