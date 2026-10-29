import mongoose from 'mongoose';
import { appendOnly, ref } from '../fields.js';
import { OFFER_EVENT_KINDS } from '../../config/occasions.js';

// Everything that happened to an offer: the timeline in the side drawer. Rows are never changed or removed.
const offerEventSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    offerId: ref('OfferIssue', { required: true }),
    customerId: ref('Customer', { required: true }),
    kind: { type: String, enum: OFFER_EVENT_KINDS, required: true },
    actorId: ref('User', { default: null }), // null = the app did it by itself
    actorName: { type: String, default: 'System' },
    note: { type: String, trim: true },
    outcome: { type: String, default: null }, // CONTACT: the call outcome (REACHED, NO_ANSWER...); SENT: the channel
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'offer_events' }
);

offerEventSchema.index({ offerId: 1, createdAt: 1 });

appendOnly(offerEventSchema, 'Offer history');

export default mongoose.model('OfferEvent', offerEventSchema);
