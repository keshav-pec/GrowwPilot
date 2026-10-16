import mongoose from 'mongoose';
import { ref } from '../fields.js';

// "A service was completed" events waiting to take stock. Written in the same transaction as the appointment
// change, handled right after, and retried every few minutes if something went wrong.
const inventoryOutboxSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    type: { type: String, enum: ['SERVICE_COMPLETED'], required: true },
    dedupeKey: { type: String, required: true }, // one event per appointment completion
    appointmentId: ref('Appointment', { required: true }),
    completedAt: { type: Date, required: true },
    completedBy: { id: ref('User'), name: String },
    status: { type: String, enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    lastError: String,
    lockedAt: Date,
    nextAttemptAt: { type: Date, default: Date.now },
    processedAt: Date,
  },
  { timestamps: true, collection: 'inventory_outbox' }
);

inventoryOutboxSchema.index({ orgId: 1, dedupeKey: 1 }, { unique: true });
inventoryOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

export default mongoose.model('InventoryOutbox', inventoryOutboxSchema);
