import mongoose from 'mongoose';
import { appendOnly, ref } from './fields.js';

// Who did what, and when. Rows are only ever added: nothing in the app edits or removes them.
const activityLogSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { default: null }), // decides which owners can see it
    actorId: ref('User', { required: true }),
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true }, // "Business owner", "Branch owner" or "Front desk"
    action: { type: String, required: true }, // e.g. "pay_plan.created"
    staffId: ref('Staff'),
    invoiceId: ref('Invoice'), // billing actions: the bill it was about (its history on the bill page)
    summary: { type: String, required: true }, // one plain sentence, shown in the log
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ orgId: 1, createdAt: -1 });
activityLogSchema.index({ invoiceId: 1, createdAt: 1 }, { partialFilterExpression: { invoiceId: { $type: 'objectId' } } });

appendOnly(activityLogSchema, 'Activity log entries');

export default mongoose.model('ActivityLog', activityLogSchema, 'activity_log');
