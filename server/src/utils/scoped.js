import mongoose from 'mongoose';

// Adds the user's salon to a database filter, so a query can never reach another salon's data.
//
//   Customer.findOne(scoped(req.ctx, { _id: id }))   ✅  -> { orgId: <my salon>, _id: id }
//   Customer.findById(id)                             ❌  could return another salon's customer
export function scoped(ctx, extra = {}) {
  return { orgId: ctx.orgId, ...extra };
}

// aggregate() doesn't turn text ids into ObjectIds like find() does, so they're converted with this
export const oid = (id) => new mongoose.Types.ObjectId(String(id));
