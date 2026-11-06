import mongoose from 'mongoose';
import { ref } from './fields.js';
import { FILING_FREQUENCIES } from '../config/gst.js';

// One branch's use of this GSTIN between two dates ("YYYY-MM-DD"; no end date = still in use).
// A correction that takes effect from a branch's first day leaves an empty period here (to before from), as history.
const branchLinkSchema = new mongoose.Schema(
  {
    branchId: ref('Branch', { required: true }),
    from: { type: String, required: true },
    to: { type: String, default: null },
  },
  { _id: false }
);

// A GST registration. Rows are never rewritten: fixing a GSTIN closes the old row and adds a new dated one,
// so a bill can always be traced to the GSTIN that applied on its date.
const gstRegistrationSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    gstin: { type: String, required: true, trim: true, uppercase: true },
    legalName: { type: String, required: true, trim: true },
    stateCode: { type: String, required: true, match: /^\d{2}$/ },
    filingFrequency: { type: String, enum: FILING_FREQUENCIES, default: 'MONTHLY' },
    from: { type: String, required: true },
    to: { type: String, default: null }, // set when every branch has moved off it
    branches: [branchLinkSchema],
    createdBy: ref('User'),
  },
  { timestamps: true, collection: 'gst_registrations' }
);

gstRegistrationSchema.index({ orgId: 1, gstin: 1, from: 1 }, { unique: true });

export default mongoose.model('GstRegistration', gstRegistrationSchema);
