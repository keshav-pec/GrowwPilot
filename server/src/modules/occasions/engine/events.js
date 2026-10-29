import { OfferEvent } from '../../../models/index.js';

// Adds timeline rows. offers: [{ _id, customerId }]. ctx = null means the app did it by itself.
export async function addOfferEvents(orgId, offers, kind, { ctx = null, note, outcome = null } = {}, session = null) {
  if (offers.length === 0) return;
  const actor = ctx ? { actorId: ctx.userId, actorName: ctx.userName } : {};
  await OfferEvent.insertMany(
    offers.map((o) => ({ orgId, offerId: o._id, customerId: o.customerId, kind, note, outcome, ...actor })),
    { session, ordered: true }
  );
}
