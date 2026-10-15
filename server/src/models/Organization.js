import mongoose from 'mongoose';
import { PLANS } from '../config/constants.js';
import { ADDONS } from '../config/addons.js';
import { ref } from './fields.js';

// One add-on's switch. The data an add-on creates is kept when it is switched off.
const addonSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    enabledAt: Date,
    enabledBy: ref('User'), // the Super Admin who switched it on
    disabledAt: Date,
  },
  { _id: false }
);

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
    // Paid add-ons, switched on by the Super Admin: { inventory: { enabled, enabledAt, enabledBy } }
    addons: Object.fromEntries(ADDONS.map((name) => [name, { type: addonSchema, default: () => ({}) }])),
  },
  { timestamps: true }
);

export default mongoose.model('Organization', organizationSchema);
