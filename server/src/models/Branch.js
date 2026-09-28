import mongoose from 'mongoose';
import { ref, TIME_REGEX } from './fields.js';
import { isValidTimezone } from '../utils/time.js';

// One salon location. Opening hours are in the branch's own timezone.
const branchSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    timezone: {
      type: String,
      required: true,
      default: 'Asia/Kolkata',
      validate: { validator: isValidTimezone, message: '{VALUE} is not a valid timezone' },
    },
    openTime: { type: String, default: '09:00', match: TIME_REGEX },
    closeTime: { type: String, default: '21:00', match: TIME_REGEX },
    defaultServiceMinutes: { type: Number, default: 30, min: 5 }, // used when a service has no duration
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

branchSchema.index({ orgId: 1 });

export default mongoose.model('Branch', branchSchema);
