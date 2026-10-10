import mongoose from 'mongoose';
import { ref } from './fields.js';

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
    summary: { type: String, required: true }, // one plain sentence, shown in the log
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ orgId: 1, createdAt: -1 });

// Refuse any attempt to change an existing row
function refuseChange() {
  throw new Error('Activity log entries cannot be changed');
}
activityLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], refuseChange);
activityLogSchema.pre('save', function () {
  if (!this.isNew) refuseChange();
});

export default mongoose.model('ActivityLog', activityLogSchema, 'activity_log');
