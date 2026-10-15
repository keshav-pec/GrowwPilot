import mongoose from 'mongoose';
import { ref } from '../fields.js';

// A spreadsheet (CSV) import waiting to be confirmed: every row with what was found wrong with it.
// Nothing is saved as a product until it is committed. Removed automatically after 24 hours.
const problemSchema = new mongoose.Schema(
  {
    field: String, // the CSV column, e.g. 'way_of_use'
    level: { type: String, enum: ['error', 'warning'] },
    message: String,
  },
  { _id: false }
);

const importRowSchema = new mongoose.Schema(
  {
    row: Number, // line in the file (the header is line 1)
    raw: { type: mongoose.Schema.Types.Mixed }, // what the file said, so the screen can fix and check it again
    values: { type: mongoose.Schema.Types.Mixed }, // cleaned up, ready to save
    status: { type: String, enum: ['ready', 'warning', 'error'] },
    problems: [problemSchema],
  },
  { _id: false }
);

const inventoryImportSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    createdBy: ref('User', { required: true }),
    fileName: String,
    rows: [importRowSchema],
    status: { type: String, enum: ['preview', 'committed'], default: 'preview' },
    committedAt: Date,
    result: { created: Number, withStock: Number, skipped: Number },
    createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 },
  },
  { collection: 'inventory_imports' }
);

export default mongoose.model('InventoryImport', inventoryImportSchema);
