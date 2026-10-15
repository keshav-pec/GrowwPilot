import mongoose from 'mongoose';
import { ref } from './fields.js';

// The saved result of a change that was sent with an Idempotency-Key header.
// The same key sent again (double click, network retry) gets this result back instead of doing the change twice.
// Saved in the same transaction as the change itself, so they can't get out of step. Kept for 7 days.
const idempotencyRecordSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    key: { type: String, required: true },
    operation: { type: String, required: true }, // e.g. 'inventory.sku.create'
    status: { type: Number, default: 200 }, // HTTP status of the first answer
    result: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 },
  },
  { collection: 'idempotency_records' }
);

idempotencyRecordSchema.index({ orgId: 1, key: 1 }, { unique: true });

export default mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
