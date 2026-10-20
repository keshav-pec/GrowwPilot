import { InventoryLocation, InventorySku, Service } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { LINE_KINDS as KIND_NAMES } from '../../config/billing.js';
import { reverseCommissions } from '../payroll/commission.service.js';
import { postMovement } from '../inventory/stock/stock.engine.js';

// ---------------------------------------------------------------------------
// The kinds of line a bill can have (BILLING_PLAN.md, Phase 4). Billing only talks to a line through its kind,
// so a new kind (PACKAGE, MEMBERSHIP, GIFT_CARD...) is added here, plus its name in config/billing.js,
// without changing how bills are priced, issued, refunded or voided.
//
// Each kind says:
//   label            how it is called on screens
//   discountable     false: no line discount, and no share of a bill discount (e.g. a gift card)
//   needsCustomer    true: a bill with this line can't go to "Guest"
//   removable        false: it can't be taken off a draft (services come from the appointment)
//   hasQuantity      true: the desk can change how many
//   requiresAddon    the salon add-on it needs (e.g. 'inventory')
//   lookup(ctx, lines, session)      -> what tax() needs, loaded once for all lines of this kind
//   tax(line, settings, lookup)      -> { taxRateBps, sacCode?, hsnCode? } today's GST rate and code
//   onIssue(ctx, { invoice, lines }, session)              when the bill is issued (same transaction)
//   onRefund(ctx, { invoice, refund, lines (the refunded parts), day }, session)  when lines are refunded
//   onVoid(ctx, { invoice, lines }, session)               when the bill is voided (same transaction)
// The hooks are optional.
// ---------------------------------------------------------------------------

const find = (list, id) => list.find((x) => String(x._id) === String(id));

// The branch's main store, where products are sold from and returned to
async function mainStoreOf(ctx, branchId, session) {
  const store = await InventoryLocation.findOne(scoped(ctx, { branchId, isMain: true })).session(session).lean();
  if (!store) throw new AppError(409, 'NO_STORE', 'This branch has no stock set up yet');
  return store;
}

// Puts products back into the main store (a return, or a voided bill). requestKey(line) keeps it exactly once.
async function backToStore(ctx, { invoice, items, note, requestKey }, session) {
  const store = await mainStoreOf(ctx, invoice.branchId, session);
  for (const { line, qty } of items) {
    await postMovement(
      ctx,
      { branchId: invoice.branchId, type: 'SALE_RETURN', note, reference: { kind: 'invoice', id: invoice._id }, requestKey: requestKey(line), lines: [{ skuId: line.skuId, locationId: store._id, qty, bucket: 'SOLD' }] },
      session
    );
  }
  return store;
}

export const LINE_KINDS = {
  // A service done in an appointment. The stylist earns commission on it (see payroll/commission.service.js).
  SERVICE: {
    label: 'Service',
    discountable: true,
    needsCustomer: true,
    removable: false,
    hasQuantity: false,
    async lookup(ctx, lines, session) {
      return Service.find(scoped(ctx, { _id: { $in: lines.map((l) => l.serviceId).filter(Boolean) } })).select('taxRateBps sacCode').session(session).lean();
    },
    tax(line, settings, services) {
      const service = find(services, line.serviceId);
      return {
        taxRateBps: settings.gstRegistered ? (service?.taxRateBps ?? settings.defaultServiceTaxBps) : 0,
        sacCode: service?.sacCode || settings.defaultSacCode || undefined,
      };
    },
    // A refunded service's commission is taken back. The products it used are not returned.
    async onRefund(ctx, { invoice, refund, lines: parts, day }, session) {
      const itemIds = parts.map((p) => invoice.lines.find((l) => String(l._id) === String(p.lineId))?.itemId).filter(Boolean);
      if (itemIds.length > 0) await reverseCommissions({ invoice, itemIds, eventKey: `refund:${refund._id}`, day }, session);
    },
  },

  // A retail product from Inventory, sold in whole stock units from the branch's main store
  PRODUCT: {
    label: 'Product',
    discountable: true,
    needsCustomer: false,
    removable: true,
    hasQuantity: true,
    requiresAddon: 'inventory',
    async lookup(ctx, lines, session) {
      return InventorySku.find(scoped(ctx, { _id: { $in: lines.map((l) => l.skuId).filter(Boolean) } })).select('taxRateBps hsnCode').session(session).lean();
    },
    tax(line, settings, skus) {
      const sku = find(skus, line.skuId);
      return {
        taxRateBps: settings.gstRegistered ? (sku?.taxRateBps ?? settings.defaultProductTaxBps ?? 1800) : 0,
        hsnCode: sku?.hsnCode || undefined,
      };
    },
    // The products leave the main store, exactly once: this runs in the issue's own transaction
    async onIssue(ctx, { invoice, lines }, session) {
      const store = await mainStoreOf(ctx, invoice.branchId, session);
      for (const line of lines) {
        try {
          await postMovement(
            ctx,
            { branchId: invoice.branchId, type: 'SALE', note: `Bill ${invoice.invoiceNumber}`, reference: { kind: 'invoice', id: invoice._id }, requestKey: `sale:${invoice._id}:${line._id}`, lines: [{ skuId: line.skuId, locationId: store._id, qty: -line.qty, bucket: 'SOLD' }] },
            session
          );
        } catch (err) {
          if (err.code === 'INSUFFICIENT_AVAILABLE_STOCK') throw new AppError(409, 'NOT_ENOUGH_STOCK', `Not enough ${line.name} in stock: ${err.details.available} left in ${store.name}`, err.details);
          throw err;
        }
      }
    },
    // Sellable returns go back into the main store; damaged ones come back and are written off
    async onRefund(ctx, { invoice, refund, lines: parts }, session) {
      const items = parts.map((p) => ({ part: p, line: invoice.lines.find((l) => String(l._id) === String(p.lineId)), qty: p.qty }));
      const store = await backToStore(ctx, { invoice, items, note: `Returned on bill ${invoice.invoiceNumber}`, requestKey: (line) => `return:${refund._id}:${line._id}` }, session);
      for (const { part, line } of items.filter((i) => i.part.restock === 'DAMAGED')) {
        await postMovement(
          ctx,
          { branchId: invoice.branchId, type: 'WRITE_OFF', reason: 'DAMAGE', note: `Returned damaged on bill ${invoice.invoiceNumber}`, reference: { kind: 'invoice', id: invoice._id }, requestKey: `return-damaged:${refund._id}:${line._id}`, lines: [{ skuId: line.skuId, locationId: store._id, qty: -part.qty, bucket: 'WASTED' }] },
          session
        );
      }
    },
    async onVoid(ctx, { invoice, lines }, session) {
      await backToStore(ctx, { invoice, items: lines.map((line) => ({ line, qty: line.qty })), note: `Bill ${invoice.invoiceNumber} voided`, requestKey: (line) => `void:${invoice._id}:${line._id}` }, session);
    },
  },
};

// Every kind named in config/billing.js has an entry here (checked once, when the server starts)
for (const name of KIND_NAMES) if (!LINE_KINDS[name]) throw new Error(`Bill line kind ${name} has no entry in billing/lineKinds.js`);

export function kindOf(line) {
  const kind = LINE_KINDS[line.kind];
  if (!kind) throw new AppError(400, 'VALIDATION_ERROR', `Unknown kind of bill line: ${line.kind}`);
  return kind;
}

// Lines grouped by kind: [[name, kind, lines]] (only kinds that are on the bill)
export function byKind(lines) {
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.kind)) groups.set(line.kind, []);
    groups.get(line.kind).push(line);
  }
  return [...groups].map(([name, list]) => [name, kindOf({ kind: name }), list]);
}

// Runs one hook (onIssue / onRefund / onVoid) for every kind on the bill that has it
export async function runHook(hook, ctx, lines, args, session) {
  for (const [, kind, list] of byKind(lines)) {
    if (kind[hook]) await kind[hook](ctx, { ...args, lines: list }, session);
  }
}
