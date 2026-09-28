import mongoose from 'mongoose';
import { ref, money } from './fields.js';

// A bundle of services sold at one price, e.g. "Haircut + Beard Trim for ₹600".
const comboSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    name: { type: String, required: true, trim: true },
    serviceIds: {
      type: [ref('Service')],
      validate: { validator: (ids) => ids.length >= 2, message: 'A combo needs at least 2 services' },
    },
    comboPrice: money({ required: true }),
    branchIds: [ref('Branch')], // empty = offered at every branch
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  },
  { timestamps: true }
);

comboSchema.index({ orgId: 1 });

export default mongoose.model('Combo', comboSchema);
