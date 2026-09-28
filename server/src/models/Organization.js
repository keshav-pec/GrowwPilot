import mongoose from 'mongoose';
import { PLANS } from '../config/constants.js';

// One salon brand. This is the "tenant": every other record points to an organization.
const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true }, // e.g. "glamour-studio"
    ownerName: { type: String, required: true, trim: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    contactPhone: { type: String, trim: true },
    city: { type: String, trim: true },
    plan: { type: String, enum: PLANS, default: 'trial' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

export default mongoose.model('Organization', organizationSchema);
