import mongoose from 'mongoose';
import { ref, phone } from './fields.js';
import { CONSENT_CHANNELS, CONSENT_SOURCES, CONSENT_STATUSES, DATE_SOURCES, dayFitsMonth } from '../config/occasions.js';

// A birthday or wedding anniversary: the month is needed, the day is optional, the year is never kept.
const occasionDateSchema = new mongoose.Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    day: {
      type: Number,
      default: null,
      // (the services check this too; here it guards every save, e.g. 31 November)
      validate: {
        validator: function (day) {
          return day == null || typeof this?.month !== 'number' || dayFitsMonth(this.month, day);
        },
        message: 'That day is not in the chosen month',
      },
    },
    source: { type: String, enum: DATE_SOURCES, required: true }, // CUSTOMER, STAFF, IMPORTED or MIGRATED
    updatedAt: Date,
    updatedBy: ref('User'),
  },
  { _id: false }
);

// Permission to send offers on one channel. UNKNOWN counts as "no".
const consentSchema = new mongoose.Schema(
  {
    status: { type: String, enum: CONSENT_STATUSES, default: 'UNKNOWN' },
    source: { type: String, enum: CONSENT_SOURCES },
    noticeVersion: String, // the consent wording the customer agreed to, e.g. "v1"
    evidence: String, // short note on how it was given
    changedAt: Date,
    changedBy: ref('User'),
  },
  { _id: false }
);

// A salon's customer. Shared by all branches of the same salon; the home branch decides who follows up offers.
// Visits, spend and last visit are NOT stored here; they are calculated from appointments and invoices.
const customerSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    name: { type: String, required: true, trim: true },
    phone: phone({ required: true }),
    email: { type: String, lowercase: true, trim: true },
    dob: Date, // old full date of birth: copied into occasions.birthday, no longer shown or changed
    notes: { type: String, trim: true },
    preferredStaffId: ref('Staff'),
    homeBranchId: ref('Branch'),
    // Birthday and anniversary month (and day). null = cleared on purpose; missing = never set.
    occasions: {
      birthday: { type: occasionDateSchema },
      anniversary: { type: occasionDateSchema },
    },
    // Permission to message, per channel, plus when the last offer message went out (the 7-day limit)
    marketing: {
      ...Object.fromEntries(CONSENT_CHANNELS.map((channel) => [channel, { type: consentSchema, default: () => ({}) }])),
      lastPromoAt: Date,
    },
  },
  { timestamps: true }
);

// One phone number = one customer per salon. The same phone can exist in another salon.
customerSchema.index({ orgId: 1, phone: 1 }, { unique: true });
// "Whose birthday is in November at Andheri?"
customerSchema.index({ orgId: 1, homeBranchId: 1, 'occasions.birthday.month': 1 });
customerSchema.index({ orgId: 1, homeBranchId: 1, 'occasions.anniversary.month': 1 });

export default mongoose.model('Customer', customerSchema);
