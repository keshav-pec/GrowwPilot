import { OfferIssue } from '../../../models/index.js';
import { addOfferEvents } from './events.js';

const BATCH = 5000;

// Offers still unused after their month: EXPIRED, and their open task closed. Returns how many.
export async function expireOffers(orgId, now = new Date()) {
  let expired = 0;
  for (;;) {
    const due = await OfferIssue.find({ orgId, status: 'ISSUED', validUntil: { $lt: now } }).select('_id customerId').limit(BATCH).lean();
    if (due.length === 0) break;
    // A task already closed (e.g. "Unreachable") keeps its own reason
    await OfferIssue.collection.updateMany({ _id: { $in: due.map((o) => o._id) }, status: 'ISSUED' }, [
      {
        $set: {
          status: 'EXPIRED',
          task: { $cond: [{ $eq: ['$task.state', 'CLOSED'] }, '$task', { $mergeObjects: ['$task', { state: 'CLOSED', closedReason: 'EXPIRED', closedAt: now }] }] },
        },
      },
    ]);
    await addOfferEvents(orgId, due, 'EXPIRED');
    expired += due.length;
    if (due.length < BATCH) break;
  }
  return expired;
}
