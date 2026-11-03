import mongoose from 'mongoose';
import { ref } from './fields.js';

export const PASSWORD_TOKEN_PURPOSES = ['RESET', 'INVITE']; // RESET: "Forgot password?" (1 hour); INVITE: set-password link from an owner (48 hours)

// A one-time link to choose a password. Only a hash of the token is kept, so someone reading the database
// can't use it. A new link cancels the person's older ones. Rows are removed a week after they expire.
const passwordTokenSchema = new mongoose.Schema(
  {
    userId: ref('User', { required: true }),
    orgId: ref('Organization', { required: true }),
    purpose: { type: String, enum: PASSWORD_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    createdBy: { id: ref('User', { default: null }), name: String }, // null = the person asked for it themselves
  },
  { timestamps: true, collection: 'password_tokens' }
);

passwordTokenSchema.index({ tokenHash: 1 }, { unique: true });
passwordTokenSchema.index({ userId: 1, createdAt: -1 });
passwordTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.model('PasswordToken', passwordTokenSchema);
