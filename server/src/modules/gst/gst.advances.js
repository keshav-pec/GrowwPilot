// Tax on advances "for named services": worked out when the money comes in, used up on later bills, never twice.
import { Customer, Invoice, Service } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { GST_STATES } from '../../config/billing.js';
import { creditForAmount, lineTax } from '../billing/tax.rules.js';
import { billContext, gstSetupActive, missingRuleBlocker } from './gst.billing.js';
import { ruleFor } from './gst.rules.js';

// The money is what the customer paid, so the tax is always inside it: ₹4,999 at 5% -> ₹4,760.95 + ₹238.05
const INSIDE = { gstRegistered: true, pricesIncludeTax: true, useTaxRules: true, interstate: false };

// The tax on an advance for these services at this branch, or an error saying why not.
// The rate comes from the services' approved rule: nobody chooses it. All the services must share one rule.
// billId: the money is for a bill already issued. That bill already carries the tax, so no advance tax can be added.
export async function advanceTaxFor(ctx, { branchId, amount, forServiceIds, billId = null, settings }, session = null) {
  if (!gstSetupActive(settings)) throw new AppError(409, 'GST_NOT_ACTIVE', 'Advances for named services need GST setup to be active');
  if (billId) {
    const bill = await Invoice.findOne(scoped(ctx, { _id: billId, status: 'ISSUED' })).select('invoiceNumber').session(session).lean();
    if (!bill) throw new AppError(404, 'NOT_FOUND', 'Bill not found');
    throw new AppError(409, 'ADVANCE_ALREADY_TAXED', `Bill ${bill.invoiceNumber} already has GST on this money. Record the payment on the bill instead.`, { invoiceId: bill._id });
  }

  const gst = await billContext(ctx, { branchId }, session);
  if (gst.blockers.length > 0) throw new AppError(409, gst.blockers[0].code, gst.blockers[0].message, { blockers: gst.blockers });

  const services = await Service.find(scoped(ctx, { _id: { $in: forServiceIds } })).select('name taxRuleGroupId').session(session).lean();
  if (services.length !== new Set(forServiceIds.map(String)).size) throw new AppError(404, 'NOT_FOUND', 'Service not found');
  const rules = new Map();
  for (const service of services) {
    const rule = ruleFor(gst.rules, service.taxRuleGroupId, gst.taxDate);
    if (!rule) {
      const blocker = missingRuleBlocker({ kind: 'SERVICE', name: service.name, serviceId: service._id }, gst.taxDate);
      throw new AppError(409, blocker.code, blocker.message, { blockers: [blocker] });
    }
    rules.set(String(rule._id), rule);
  }
  if (rules.size !== 1) throw new AppError(400, 'ADVANCE_MIXED_RULES', 'These services have different tax rules. Take a separate advance for each.');
  const rule = [...rules.values()][0];
  const tax = lineTax(amount, rule.rateBps, INSIDE);
  return {
    forServices: services.map((s) => ({ serviceId: s._id, name: s.name })),
    gst: {
      taxRuleId: rule._id,
      taxRuleName: rule.name,
      code: rule.code,
      rateBps: rule.rateBps,
      itcType: rule.itcType,
      taxDate: gst.taxDate,
      gstin: gst.registration.gstin,
      legalName: gst.registration.legalName,
      stateCode: gst.registration.stateCode,
      stateName: GST_STATES[gst.registration.stateCode],
      placeOfSupply: { stateCode: gst.placeOfSupply.stateCode, stateName: gst.placeOfSupply.stateName },
      taxable: tax.taxableAmount,
      cgst: tax.cgst,
      sgst: tax.sgst,
      igst: tax.igst ?? 0,
      leftTaxable: tax.taxableAmount,
      leftCgst: tax.cgst,
      leftSgst: tax.sgst,
      leftIgst: tax.igst ?? 0,
    },
  };
}

// The buyer's details, as printed on the receipt voucher
export async function advanceBuyer(ctx, customerId, session = null) {
  const customer = await Customer.findOne(scoped(ctx, { _id: customerId })).select('name phone gstin gstLegalName').session(session).lean();
  return { customerName: customer?.name, phone: customer?.phone, ...(customer?.gstin ? { buyer: { gstin: customer.gstin, legalName: customer.gstLegalName || customer.name } } : {}) };
}

// The share of an advance's tax that `part` of its money carries. The last of it takes whatever is left,
// so the tax used can never come to more than the tax paid.
export function advanceTaxPart(advance, part) {
  const g = advance.gst;
  return creditForAmount(
    {
      name: 'this advance',
      qty: 1,
      lineTotal: advance.amount,
      taxableAmount: g.taxable,
      cgst: g.cgst,
      sgst: g.sgst,
      igst: g.igst,
      creditedTaxable: g.taxable - g.leftTaxable,
      creditedCgst: g.cgst - g.leftCgst,
      creditedSgst: g.sgst - g.leftSgst,
      creditedIgst: g.igst - g.leftIgst,
    },
    part
  );
}

// The update that takes a part's tax off an advance
export const takeAdvanceTax = (part) => ({ 'gst.leftTaxable': -part.taxableAmount, 'gst.leftCgst': -part.cgst, 'gst.leftSgst': -part.sgst, 'gst.leftIgst': -part.igst });

// Whose bill is this? A taxed advance only pays bills under its own GSTIN and place of supply. Plain advances pay any bill.
export const sellerOfBill = (invoice) => ({ gstin: invoice.seller?.gstin ?? null, place: invoice.placeOfSupply?.stateCode ?? invoice.seller?.stateCode ?? null });
export const advanceFitsBill = (advance, seller) => !advance.taxed || (advance.gst.gstin === seller.gstin && advance.gst.placeOfSupply?.stateCode === seller.place);
