// The bill maths: discounts and GST. Pure functions (no database), so they are easy to test and explain.
// Money is whole paise; tax rates and percentage discounts are basis points (1800 = 18%).
import { AppError } from '../../utils/AppError.js';
import { formatMoney } from '../../utils/money.js';
import { splitByPrice } from '../payroll/commission.rules.js';

// num / den rounded to the nearest whole number, halves going up (both are whole numbers >= 0).
// Done in whole numbers so there are no floating-point surprises: roundHalfUp(5, 2) -> 3
export function roundHalfUp(num, den) {
  return Math.floor((2 * num + den) / (2 * den));
}

// A percentage typed by a person (up to 2 decimals) -> basis points: 12.5 -> 1250
export function percentToBps(percent) {
  return Math.round(percent * 100);
}

// How much a discount takes off `amount`. discount: { type: 'flat' (paise) | 'percent' (0-100), value }
function discountAmount(amount, discount, what) {
  if (!discount || !discount.value) return 0;
  if (discount.type === 'percent') {
    if (discount.value > 100) throw new AppError(400, 'INVALID_DISCOUNT', 'A percentage discount can be at most 100%');
    return roundHalfUp(amount * percentToBps(discount.value), 10000);
  }
  if (!Number.isInteger(discount.value)) throw new AppError(400, 'INVALID_DISCOUNT', 'Discount must be in whole paise');
  if (discount.value > amount) {
    throw new AppError(400, 'INVALID_DISCOUNT', `The discount on ${what} can't be more than ${formatMoney(amount)}`);
  }
  return discount.value;
}

// GST on one line's final price `amount`. CGST and SGST are each half the rate and always equal.
//   Prices include GST:  ₹1,180 at 18% -> taxable ₹1,000 + CGST ₹90 + SGST ₹90 = ₹1,180 (the customer pays the price shown)
//   GST added on top:    ₹1,000 at 18% -> taxable ₹1,000 + CGST ₹90 + SGST ₹90 = ₹1,180
//   Not GST registered:  no tax at all
export function lineTax(amount, rateBps, { gstRegistered, pricesIncludeTax }) {
  if (!gstRegistered || !rateBps) return { taxableAmount: amount, cgst: 0, sgst: 0, lineTotal: amount };
  if (pricesIncludeTax) {
    const half = roundHalfUp(amount * rateBps, 2 * (10000 + rateBps));
    return { taxableAmount: amount - 2 * half, cgst: half, sgst: half, lineTotal: amount };
  }
  const half = roundHalfUp(amount * rateBps, 2 * 10000);
  return { taxableAmount: amount, cgst: half, sgst: half, lineTotal: amount + 2 * half };
}

// ---------------------------------------------------------------------------
// The whole bill, step by step:
//   1. each line's price x qty, minus its combo price gap        -> what the line costs
//   2. minus the line's own discount (flat or %)                   -> after line discount
//   3. the bill discount (flat or % of everything) is shared over the lines by their amounts, to the paisa
//   4. GST is worked out on each line's final amount, rounded per line (half up)
//
// lines: [{ unitPrice, qty, comboDiscount, discount: { type, value } | null, taxRateBps, name, discountable (default true) }]
// A line that is not discountable (e.g. a future gift card) takes no line discount and no share of the bill discount.
// billDiscount: { type, value } | null
// mode: { gstRegistered, pricesIncludeTax }
// ---------------------------------------------------------------------------
export function computeBill(lines, billDiscount, mode) {
  const afterCombo = lines.map((l) => Math.max(l.unitPrice * (l.qty ?? 1) - (l.comboDiscount ?? 0), 0));
  const lineDiscounts = lines.map((l, i) => {
    if (l.discountable === false && l.discount?.value) throw new AppError(400, 'INVALID_DISCOUNT', `${l.name ?? 'This line'} can’t be discounted`);
    return discountAmount(afterCombo[i], l.discount, l.name ?? 'this line');
  });
  const afterLine = afterCombo.map((amount, i) => amount - lineDiscounts[i]);

  // The bill discount is shared over the lines that can be discounted, by their amounts
  const sharable = afterLine.map((amount, i) => (lines[i].discountable === false ? 0 : amount));
  const beforeBillDiscount = sharable.reduce((a, b) => a + b, 0);
  const billDiscountTotal = discountAmount(beforeBillDiscount, billDiscount, 'the bill');
  const billShares = billDiscountTotal === 0 ? sharable.map(() => 0) : splitByPrice(sharable, billDiscountTotal);

  const out = lines.map((l, i) => {
    const gross = l.unitPrice * (l.qty ?? 1);
    const amount = afterLine[i] - billShares[i];
    return {
      gross,
      comboDiscount: gross - afterCombo[i],
      lineDiscount: lineDiscounts[i],
      billDiscountShare: billShares[i],
      taxRateBps: mode.gstRegistered ? l.taxRateBps : 0,
      ...lineTax(amount, l.taxRateBps, mode),
    };
  });

  const sum = (field) => out.reduce((total, l) => total + l[field], 0);
  const subtotal = sum('gross');
  const comboDiscountTotal = sum('comboDiscount');
  const lineDiscountTotal = sum('lineDiscount');

  // One row per GST rate, for the tax table on the bill
  const byRate = new Map();
  for (const l of out) {
    if (!l.taxRateBps) continue;
    const row = byRate.get(l.taxRateBps) ?? { rateBps: l.taxRateBps, taxableAmount: 0, cgst: 0, sgst: 0 };
    row.taxableAmount += l.taxableAmount;
    row.cgst += l.cgst;
    row.sgst += l.sgst;
    byRate.set(l.taxRateBps, row);
  }

  return {
    lines: out,
    totals: {
      subtotal, // list prices x qty
      comboDiscountTotal,
      lineDiscountTotal,
      billDiscountTotal,
      manualDiscount: lineDiscountTotal + billDiscountTotal, // what a person chose to give (the front desk limit applies to this)
      discountTotal: comboDiscountTotal + lineDiscountTotal + billDiscountTotal,
      taxableTotal: sum('taxableAmount'),
      cgstTotal: sum('cgst'),
      sgstTotal: sum('sgst'),
      taxTotal: sum('cgst') + sum('sgst'),
      grandTotal: sum('lineTotal'),
    },
    taxSummary: [...byRate.values()].sort((a, b) => a.rateBps - b.rateBps),
  };
}

// The front desk may give discounts up to a % of the bill (after combo prices). Above that, an owner approves.
export function discountLimit(totals, limitBps) {
  return roundHalfUp((totals.subtotal - totals.comboDiscountTotal) * limitBps, 10000);
}

// Paid -> Part paid -> Unpaid, from what has been paid so far
export function settlementStatus(amountPaid, grandTotal) {
  if (amountPaid >= grandTotal) return 'PAID';
  return amountPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
}

// Where a bill stands after payments and refunds:
//   worth now = grand total - what refunds took off it;  paid now = money put on it - money handed back
//   still due = worth now - paid now (never below 0)
export function moneyState(invoice) {
  const netValue = invoice.grandTotal - (invoice.creditedTotal ?? 0);
  const netPaid = invoice.amountPaid - (invoice.refundedTotal ?? 0);
  return { netValue, netPaid, balanceDue: Math.max(netValue - netPaid, 0), settlementStatus: settlementStatus(netPaid, netValue) };
}

// The part of one bill line that `qty` units take back (a refund): taxable value, CGST, SGST and total.
// The last units take whatever is left, so all the refunds of a line always add up to exactly the line.
export function creditForLine(line, qty) {
  const left = line.qty - (line.refundedQty ?? 0);
  if (qty < 1 || qty > left) throw new AppError(400, 'VALIDATION_ERROR', `Only ${left} of ${line.name} can still be refunded`);
  const part = (field, credited) => (qty === left ? line[field] - (line[credited] ?? 0) : roundHalfUp(line[field] * qty, line.qty));
  const taxableAmount = part('taxableAmount', 'creditedTaxable');
  const cgst = part('cgst', 'creditedCgst');
  const sgst = part('sgst', 'creditedSgst');
  return { taxableAmount, cgst, sgst, amount: taxableAmount + cgst + sgst, taxRateBps: line.taxRateBps };
}
