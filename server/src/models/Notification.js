import mongoose from 'mongoose';
import { ref } from './fields.js';

// A message in one user's bell, e.g. "Kavya asked to change Rahul's pay".
const notificationSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    userId: ref('User', { required: true }),
    message: { type: String, required: true },
    link: String, // the screen to open, e.g. "/app/payroll?tab=requests"
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
