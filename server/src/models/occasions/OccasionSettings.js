import mongoose from 'mongoose';
import { TIME_REGEX, ref } from '../fields.js';
import { AUTO_EMAIL_DEFAULTS, CONSENT_CHANNELS, DEFAULT_CONSENT_TEXT } from '../../config/occasions.js';

// A salon's Birthday & Anniversary Offers settings: one row per salon, made the first time someone opens them.
// The on/off switch itself is on the Organization (so the login session knows it).
const occasionSettingsSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    // The wording a customer agrees to. {salon_name} and {channel} are filled in when it is shown.
    // Changing it raises the version (v1 -> v2), and every permission records the version it was given on.
    consentText: { type: String, trim: true, default: DEFAULT_CONSENT_TEXT },
    noticeVersion: { type: String, default: 'v1' },
    // Which channel staff use first when a customer allows several
    channelOrder: { type: [{ type: String, enum: CONSENT_CHANNELS }], default: () => [...CONSENT_CHANNELS] },
    // Automatic offer emails (campaigns set to "Send automatically by email")
    autoEmail: {
      dailyLimit: { type: Number, min: 1, max: 500, default: AUTO_EMAIL_DEFAULTS.dailyLimit },
      sendFrom: { type: String, match: TIME_REGEX, default: AUTO_EMAIL_DEFAULTS.sendFrom },
      sendUntil: { type: String, match: TIME_REGEX, default: AUTO_EMAIL_DEFAULTS.sendUntil },
    },
    // The last monthly offer run (scheduled or "Check now")
    lastRun: {
      at: Date,
      issued: Number,
      expired: Number,
      branches: Number,
      by: { type: String, enum: ['SCHEDULE', 'MANUAL', 'PUBLISH'] },
    },
    version: { type: Number, default: 0 }, // goes up on every change, so two people can't overwrite each other
    updatedBy: ref('User'),
  },
  { timestamps: true, collection: 'occasion_settings' }
);

occasionSettingsSchema.index({ orgId: 1 }, { unique: true });

export default mongoose.model('OccasionSettings', occasionSettingsSchema);
