import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { GST_RATES_BPS } from '../config/billing.js';

// Something the salon sells, e.g. "Haircut, ₹500, 45 min".
const serviceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    durationMinutes: { type: Number, min: 5 }, // optional: the branch default is used when empty
    price: money({ required: true }),
    taxRateBps: { type: Number, enum: [...GST_RATES_BPS, null], default: null }, // GST rate; empty = the salon's default
    sacCode: { type: String, trim: true, default: '' }, // GST service code, e.g. 999721; empty = the salon's default
    branchIds: [ref('Branch')], // empty = offered at every branch
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  },
  { timestamps: true }
);

serviceSchema.index({ orgId: 1 });

export default mongoose.model('Service', serviceSchema);
