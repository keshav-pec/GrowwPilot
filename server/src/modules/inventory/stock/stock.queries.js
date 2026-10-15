import { InventoryBalance, InventoryLocation } from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';

// Reading stock (writing is only ever done by stock.engine.js).

// In store and in use per product at one branch: { [skuId]: { inStore, inUse } }
// Pass the session to read inside a transaction (e.g. to answer with the balances after a change).
export async function branchStock(ctx, branchId, skuIds, session = null) {
  const [locations, balances] = await Promise.all([
    InventoryLocation.find(scoped(ctx, { branchId })).select('kind').session(session).lean(),
    InventoryBalance.find(scoped(ctx, { branchId, skuId: { $in: skuIds } })).select('skuId locationId qty').session(session).lean(),
  ]);
  const kindOf = Object.fromEntries(locations.map((l) => [String(l._id), l.kind]));

  const stock = Object.fromEntries(skuIds.map((id) => [String(id), { inStore: 0, inUse: 0 }]));
  for (const b of balances) {
    const row = stock[String(b.skuId)];
    if (kindOf[String(b.locationId)] === 'IN_USE') row.inUse += b.qty;
    else row.inStore += b.qty;
  }
  return stock;
}

// Available to issue = in store minus anything blocked (nothing can be blocked yet).
// Low stock and reorder suggestions use this, never the total that includes stock in use.
export const availableToIssue = ({ inStore }) => inStore;
