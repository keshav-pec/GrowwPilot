import mongoose from 'mongoose';
import { ref, money } from './fields.js';

const rowSchema = new mongoose.Schema(
  {
    supplierGstin: String,
    supplierName: String,
    billNumber: String,
    matchKey: String,
    billDate: String,
    kind: { type: String, enum: ['INVOICE', 'CREDIT_NOTE', 'OTHER'], default: 'INVOICE' },
    taxable: money({ default: 0 }),
    igst: money({ default: 0 }),
    cgst: money({ default: 0 }),
    sgst: money({ default: 0 }),
    itcAvailable: { type: Boolean, default: true }, // as the file says: read-only
    reason: String,
    imsStatus: String, // the portal's accept/reject status, shown as it is
  },
  { _id: false }
);

// One uploaded GSTR-2B: a read-only government statement. Later imports add a new row; the old ones stay.
const gst2bImportSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    gstin: { type: String, required: true },
    period: { type: String, required: true },
    fileHash: { type: String, required: true },
    fileName: String,
    source: { type: String, enum: ['JSON', 'CSV'], required: true },
    rows: [rowSchema],
    importedBy: ref('User'),
    importedByName: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'gst_2b_imports' }
);

// The same file for the same month is one import
gst2bImportSchema.index({ orgId: 1, gstin: 1, period: 1, fileHash: 1 }, { unique: true });

export default mongoose.model('Gst2bImport', gst2bImportSchema);
