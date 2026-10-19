// Moves bills made before Billing Phase 1 onto the new bill shape. Safe to run any number of times:
// a bill is only converted once, and nothing else is touched.
//   - Old bills become ISSUED + PAID and keep their old numbers (GP-AND-000123), dates and amounts. No GST.
//   - Their embedded payments move into Payment + PaymentAllocation records.
//   - The old "one bill per appointment" and "unique number" indexes are replaced by ones that allow drafts.
// It runs by itself when the server starts and at the end of the seed. To run it by hand:
//   node src/scripts/migrate-billing-v2.js
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { Appointment, Branch, CommissionEntry, Customer, Invoice, Organization, Payment, PaymentAllocation } from '../models/index.js';
import { financialYear } from '../config/billing.js';
import { computeBill } from '../modules/billing/tax.rules.js';
import { splitByPrice } from '../modules/payroll/commission.rules.js';

const { ObjectId } = mongoose.Types;

// The new fields for one old bill, or null if its numbers don't add up (left alone, and reported)
export function convertOldBill(doc, { appointment, customer, branch, org }) {
  const prices = doc.lines.map((l) => l.price);
  const itemsTotal = prices.reduce((a, b) => a + b, 0);
  // Old bills kept the combo price as `subtotal`; share it over the services like new bills do
  const shares = doc.subtotal === itemsTotal ? prices : splitByPrice(prices, doc.subtotal);
  const unitPrices = doc.subtotal > itemsTotal ? shares : prices; // a combo priced above its services
  const comboDiscounts = unitPrices.map((p, i) => p - shares[i]);
  const discount = doc.discount ?? 0;

  const bill = computeBill(
    doc.lines.map((l, i) => ({ name: l.serviceName, unitPrice: unitPrices[i], qty: 1, comboDiscount: comboDiscounts[i], discount: null, taxRateBps: 0 })),
    { type: 'flat', value: discount },
    { gstRegistered: false, pricesIncludeTax: true }
  );
  if (bill.totals.grandTotal !== doc.total) return null;

  // Old lines were written in the appointment's order, so they match its services one to one
  const items = appointment?.items?.length === doc.lines.length ? appointment.items : null;
  const paidAt = doc.paidAt ?? doc.createdAt ?? new Date();
  return {
    lines: doc.lines.map((l, i) => {
      const { gross, ...amounts } = bill.lines[i];
      return {
        _id: new ObjectId(),
        kind: 'SERVICE',
        itemId: items?.[i]._id ?? null,
        serviceId: items?.[i].serviceId ?? null,
        staffId: items?.[i].staffId ?? null,
        staffName: l.staffName,
        name: l.serviceName,
        qty: 1,
        listUnitPrice: unitPrices[i],
        unitPrice: unitPrices[i],
        listComboDiscount: comboDiscounts[i],
        discountType: 'flat',
        discountValue: 0,
        ...amounts,
      };
    }),
    billDiscountType: 'flat',
    billDiscountValue: discount,
    status: 'ISSUED',
    settlementStatus: 'PAID',
    refundStatus: 'NONE',
    financialYear: financialYear(paidAt, branch?.timezone ?? 'Asia/Kolkata'),
    gstRegistered: false,
    pricesIncludeTax: true,
    subtotal: bill.totals.subtotal,
    comboDiscountTotal: bill.totals.comboDiscountTotal,
    manualDiscount: bill.totals.manualDiscount,
    discountTotal: bill.totals.discountTotal,
    taxableTotal: bill.totals.taxableTotal,
    cgstTotal: 0,
    sgstTotal: 0,
    taxTotal: 0,
    grandTotal: doc.total,
    amountPaid: doc.total,
    balanceDue: 0,
    taxSummary: [],
    seller: {
      legalName: org?.name,
      tradeName: org?.name,
      branchName: branch?.name,
      address: [branch?.address, branch?.city].filter(Boolean).join(', '),
    },
    customerSnapshot: customer ? { name: customer.name, phone: customer.phone } : (appointment?.customerSnapshot ?? {}),
    approval: { status: 'NONE' },
    issuedAt: paidAt,
    issuedBy: doc.createdBy ?? null,
    paidAt,
    version: 0,
  };
}

export async function migrateBilling({ log = console.log } = {}) {
  // Indexes first: drops the old ones that didn't allow drafts (bills) or a second commission event per
  // service (Phase 2: refunds and reversed payments), and makes the new ones
  await Invoice.syncIndexes();
  await CommissionEntry.syncIndexes();

  const old = await Invoice.collection.find({ status: { $exists: false } }).toArray();
  if (old.length === 0) return { migrated: 0, skipped: 0 };

  const ids = (field) => [...new Set(old.map((d) => d[field]).filter(Boolean).map(String))].map((id) => new ObjectId(id));
  const [appointments, customers, branches, orgs] = await Promise.all([
    Appointment.find({ _id: { $in: ids('appointmentId') } }).lean(),
    Customer.find({ _id: { $in: ids('customerId') } }).select('name phone').lean(),
    Branch.find({ _id: { $in: ids('branchId') } }).select('name address city timezone').lean(),
    Organization.find({ _id: { $in: ids('orgId') } }).select('name').lean(),
  ]);
  const byId = (list) => new Map(list.map((x) => [String(x._id), x]));
  const maps = { appointment: byId(appointments), customer: byId(customers), branch: byId(branches), org: byId(orgs) };

  let migrated = 0;
  const skipped = [];
  for (const doc of old) {
    const fields = convertOldBill(doc, {
      appointment: maps.appointment.get(String(doc.appointmentId)),
      customer: maps.customer.get(String(doc.customerId)),
      branch: maps.branch.get(String(doc.branchId)),
      org: maps.org.get(String(doc.orgId)),
    });
    if (!fields) {
      skipped.push(doc.invoiceNumber);
      continue;
    }

    await mongoose.connection.transaction(async (session) => {
      // Only if nobody converted it in the meantime
      const changed = await Invoice.collection.updateOne(
        { _id: doc._id, status: { $exists: false } },
        { $set: fields, $unset: { discount: '', total: '', payments: '' } },
        { session }
      );
      if (changed.modifiedCount !== 1) return;
      for (const p of doc.payments ?? []) {
        const [payment] = await Payment.create(
          [{ orgId: doc.orgId, branchId: doc.branchId, customerId: doc.customerId, method: p.method, amount: p.amount, reference: p.reference, receivedAt: fields.paidAt, recordedBy: doc.createdBy, source: 'MIGRATED' }],
          { session }
        );
        await PaymentAllocation.create([{ orgId: doc.orgId, branchId: doc.branchId, paymentId: payment._id, invoiceId: doc._id, amount: p.amount }], { session });
      }
      migrated += 1;
    });
  }

  if (migrated) log(`Billing: moved ${migrated} older bill${migrated === 1 ? '' : 's'} onto the new bill records`);
  if (skipped.length) log(`Billing: ${skipped.length} older bill(s) were left as they are because their amounts don't add up: ${skipped.join(', ')}`);
  return { migrated, skipped: skipped.length };
}

// Run by hand: node src/scripts/migrate-billing-v2.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  await migrateBilling();
  await mongoose.disconnect();
}
