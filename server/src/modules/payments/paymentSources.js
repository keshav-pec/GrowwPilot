import { CustomerAdvance, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { formatMoney } from '../../utils/money.js';

// ---------------------------------------------------------------------------
// Money a customer already has with the salon, that can pay a bill (BILLING_PLAN.md, Phase 4).
// Today that's advances. A future wallet, membership or package balance is added here as another source,
// and bills, payments and reports pick it up without changing.
//
// Each source says:
//   label             how it is shown on bills ("From advance")
//   allocationField   the field on PaymentAllocation that points at it (add it to the model for a new source)
//   balance(ctx, customerId, session)          -> paise the customer can use
//   take(ctx, invoice, amount, session)        takes `amount` for the bill, inside the caller's transaction,
//                                              with a guarded update (never more than there is), and writes
//                                              the allocation(s) to the bill
// ---------------------------------------------------------------------------

// What a customer has left in advances, oldest first (usable at any branch of the salon)
export async function advancesOf(ctx, customerId, session = null) {
  const advances = await CustomerAdvance.find({ orgId: ctx.orgId, customerId, remaining: { $gt: 0 } }).sort({ createdAt: 1 }).session(session).lean();
  return { advances, balance: advances.reduce((sum, a) => sum + a.remaining, 0) };
}

export const PAYMENT_SOURCES = {
  ADVANCE: {
    label: 'From advance',
    allocationField: 'advanceId',
    balance: async (ctx, customerId, session) => (await advancesOf(ctx, customerId, session)).balance,
    // Oldest advances first. Each one only ever goes down with a guarded update, so the same money
    // can never be used twice, even from two desks at once.
    async take(ctx, invoice, amount, session) {
      const { advances, balance } = await advancesOf(ctx, invoice.customerId, session);
      if (balance < amount) throw new AppError(400, 'ADVANCE_TOO_LOW', `Only ${formatMoney(balance)} is left in advances`);
      let left = amount;
      for (const advance of advances) {
        if (left === 0) break;
        const part = Math.min(advance.remaining, left);
        const used = await CustomerAdvance.updateOne({ _id: advance._id, remaining: { $gte: part } }, { $inc: { remaining: -part } }, { session });
        if (used.modifiedCount !== 1) throw new AppError(409, 'ADVANCE_CHANGED', 'That advance was just used on another bill. Please try again.');
        await PaymentAllocation.create([{ orgId: invoice.orgId, branchId: invoice.branchId, advanceId: advance._id, invoiceId: invoice._id, amount: part }], { session });
        left -= part;
      }
    },
  },
};

export function sourceOf(type) {
  const source = PAYMENT_SOURCES[type];
  if (!source) throw new AppError(400, 'VALIDATION_ERROR', `Unknown way to pay: ${type}`);
  return source;
}

// Which source an allocation came from: 'ADVANCE'..., or null for money taken now (a Payment)
export function allocationSource(allocation) {
  return Object.keys(PAYMENT_SOURCES).find((type) => allocation[PAYMENT_SOURCES[type].allocationField]) ?? null;
}

// What the customer can use from each source: { ADVANCE: paise, ... }
export async function sourceBalances(ctx, customerId, session = null) {
  const result = {};
  for (const [type, source] of Object.entries(PAYMENT_SOURCES)) result[type] = customerId ? await source.balance(ctx, customerId, session) : 0;
  return result;
}
