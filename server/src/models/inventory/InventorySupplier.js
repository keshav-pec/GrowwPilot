import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { wholeNumber } from './wholeNumber.js';

// A supplier the salon buys stock from (for every branch)
const inventorySupplierSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    name: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    paymentTerms: { type: String, trim: true }, // e.g. "30 days", "Cash on delivery"
    leadTimeDays: wholeNumber({ default: null }), // how many days a delivery usually takes
    notes: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'inventory_suppliers' }
);

inventorySupplierSchema.index({ orgId: 1, name: 1 });

export default mongoose.model('InventorySupplier', inventorySupplierSchema);
