import { Counter, InventorySku } from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';

// Product codes SKU-000123: one counter per salon. Numbers someone already typed in as their own code are skipped.
// Returns `count` free codes (several at once for a spreadsheet import).
export async function reserveSkuCodes(ctx, count, session) {
  const codes = [];
  while (codes.length < count) {
    const need = count - codes.length;
    const counter = await Counter.findOneAndUpdate({ _id: `sku:${ctx.orgId}` }, { $inc: { seq: need } }, { upsert: true, returnDocument: 'after', session });
    const candidates = Array.from({ length: need }, (_, i) => `SKU-${String(counter.seq - need + 1 + i).padStart(6, '0')}`);
    const taken = new Set(await InventorySku.distinct('code', scoped(ctx, { code: { $in: candidates } })).session(session));
    codes.push(...candidates.filter((code) => !taken.has(code)));
  }
  return codes;
}
