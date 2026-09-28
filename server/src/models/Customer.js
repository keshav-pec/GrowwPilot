import mongoose from 'mongoose';
import { ref, phone } from './fields.js';

// A salon's customer. Shared by all branches of the same salon.
// Visits, spend and last visit are NOT stored here; they are calculated from appointments and invoices.
const customerSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    name: { type: String, required: true, trim: true },
    phone: phone({ required: true }),
    email: { type: String, lowercase: true, trim: true },
    dob: Date,
    notes: { type: String, trim: true },
    preferredStaffId: ref('Staff'),
  },
  { timestamps: true }
);

// One phone number = one customer per salon. The same phone can exist in another salon.
customerSchema.index({ orgId: 1, phone: 1 }, { unique: true });

export default mongoose.model('Customer', customerSchema);
