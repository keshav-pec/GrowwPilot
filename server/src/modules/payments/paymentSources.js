import { Branch, CustomerAdvance, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { formatMoney } from '../../utils/money.js';
import { todayInZone } from '../../utils/time.js';
import { advanceFitsBill, advanceTaxPart, sellerOfBill, takeAdvanceTax } from '../gst/gst.advances.js';
import { postAdvanceUsed } from '../gst/gst.ledger.js';

// ---------------------------------------------------------------------------
// Money a customer already has with the salon, that can pay a bill: their advances.
//
// Each source says:
//   label             how it is shown on bills ("From advance")
//   allocationField   the field on PaymentAllocation that points at it
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
    // can never be used twice, even from two desks at once. A taxed advance only pays bills under its own GSTIN
    // and place of supply, and its tax is used up with the money, so the same money is never taxed twice.
    async take(ctx, invoice, amount, session) {
      const { advances, balance } = await advancesOf(ctx, invoice.customerId, session);
      const seller = sellerOfBill(invoice);
      const usable = advances.filter((a) => advanceFitsBill(a, seller));
      const usableBalance = usable.reduce((sum, a) => sum + a.remaining, 0);
      if (usableBalance < amount) {
        if (balance >= amount) throw new AppError(409, 'ADVANCE_OTHER_GSTIN', `${formatMoney(balance - usableBalance)} of this customer’s advance was taxed under another GSTIN or state, so it can’t be used on this bill. ${formatMoney(usableBalance)} can.`);
        throw new AppError(400, 'ADVANCE_TOO_LOW', `Only ${formatMoney(usableBalance)} is left in advances`);
      }
      let left = amount;
      for (const advance of usable) {
        if (left === 0) break;
        const part = Math.min(advance.remaining, left);
        const tax = advance.taxed ? advanceTaxPart(advance, part) : null;
        const used = await CustomerAdvance.updateOne({ _id: advance._id, remaining: { $gte: part } }, { $inc: { remaining: -part, ...(tax ? takeAdvanceTax(tax) : {}) } }, { session });
        if (used.modifiedCount !== 1) throw new AppError(409, 'ADVANCE_CHANGED', 'That advance was just used on another bill. Please try again.');
        const advanceTax = tax ? { taxable: tax.taxableAmount, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst } : undefined;
        const [allocation] = await PaymentAllocation.create([{ orgId: invoice.orgId, branchId: invoice.branchId, advanceId: advance._id, invoiceId: invoice._id, amount: part, advanceTax }], { session });
        if (tax) {
          const branch = await Branch.findById(invoice.branchId).select('timezone').session(session).lean();
          await postAdvanceUsed(ctx, advance, { allocationId: allocation._id, invoice, part: advanceTax, taxDate: todayInZone(branch.timezone) }, session);
        }
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
