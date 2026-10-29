import mongoose from 'mongoose';
import { appendOnly, ref } from '../fields.js';
import { CONSENT_CHANNELS, CONSENT_SOURCES, CONSENT_STATUSES } from '../../config/occasions.js';

// Every change to a customer's messaging permission: the customer's "History". Rows are never changed or removed.
const consentEventSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    customerId: ref('Customer', { required: true }),
    channel: { type: String, enum: CONSENT_CHANNELS, required: true },
    from: { type: String, enum: CONSENT_STATUSES, required: true },
    to: { type: String, enum: CONSENT_STATUSES, required: true },
    source: { type: String, enum: CONSENT_SOURCES, required: true },
    noticeVersion: String, // opt-ins: the version of the wording shown
    wording: String, // opt-ins: the exact sentence the customer agreed to
    customerAsked: { type: Boolean, default: false }, // the front desk ticked "Customer asked for this"
    note: { type: String, trim: true },
    actorId: ref('User', { required: true }),
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'consent_events' }
);

consentEventSchema.index({ orgId: 1, customerId: 1, createdAt: -1 });

appendOnly(consentEventSchema, 'Messaging permission history');

export default mongoose.model('ConsentEvent', consentEventSchema);
