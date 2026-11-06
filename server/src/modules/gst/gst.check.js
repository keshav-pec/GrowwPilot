// The nightly check: every bill, credit note and void in the salon's tax record period is compared with its entry.
// A difference is listed with a link to the bill. The business owner gets a bell only when a new one appears.
import { DateTime } from 'luxon';
import { BillingSettings, GstCheck, GstRegistration, GstTaxEntry, Refund, User } from '../../models/index.js';
import { notify } from '../notifications/notifications.service.js';
import { formatMoney } from '../../utils/money.js';
import { addOlderDocuments, documentsInScope } from './gst.ledger.js';
import { registrationFor } from './gst.rules.js';

const billLink = (invoiceId) => `/app/invoices/${invoiceId}`;
const SAME = ['taxable', 'cgst', 'sgst', 'igst'];

// -> [difference], comparing what the documents say with what the record says
export function compareDocuments({ bills, voids, notes, advances = [], uses = [], refundsById, registrations, entries }) {
  const bySource = new Map(entries.map((e) => [e.sourceKey, e]));
  const used = new Set();
  const differences = [];
  const add = (key, code, message, invoice, invoiceId = invoice?._id, branchId = invoice?.branchId) => differences.push({ key, code, message, invoiceId, branchId, link: invoiceId ? billLink(invoiceId) : undefined });

  const compare = (sourceKey, name, invoiceId, branchId, want) => {
    const entry = bySource.get(sourceKey);
    used.add(sourceKey);
    if (!entry) return add(sourceKey, 'ENTRY_MISSING', `${name} has no entry in the tax record.`, null, invoiceId, branchId);
    if (SAME.some((field) => (entry[field] ?? 0) !== (want[field] || 0))) {
      const wantTotal = SAME.reduce((sum, f) => sum + (want[f] || 0), 0);
      add(sourceKey, 'AMOUNT_DIFFERENT', `${name} is ${formatMoney(Math.abs(wantTotal))}, but the tax record has ${formatMoney(Math.abs(entry.total))}, or the tax is split differently.`, null, invoiceId, branchId);
    }
  };

  for (const { invoice, taxDate } of bills) {
    const key = `bill:${invoice._id}`;
    if (registrationFor(registrations, invoice.branchId, taxDate)?.gstin !== invoice.seller.gstin && !bySource.has(key)) {
      used.add(key);
      add(key, 'GSTIN_DIFFERENT', `Bill ${invoice.invoiceNumber} is under GSTIN ${invoice.seller.gstin}, which its branch didn’t have on ${taxDate}, so it isn’t in the tax record.`, invoice);
      continue;
    }
    compare(key, `Bill ${invoice.invoiceNumber}`, invoice._id, invoice.branchId, { taxable: invoice.taxableTotal, cgst: invoice.cgstTotal, sgst: invoice.sgstTotal, igst: invoice.igstTotal ?? 0 });
  }
  for (const { invoice } of voids) {
    compare(`void:${invoice._id}`, `Voided bill ${invoice.invoiceNumber}`, invoice._id, invoice.branchId, { taxable: -invoice.taxableTotal, cgst: -invoice.cgstTotal, sgst: -invoice.sgstTotal, igst: -(invoice.igstTotal ?? 0) });
  }
  for (const { note } of notes) {
    if (!refundsById.has(String(note.refundId))) continue;
    compare(`creditnote:${note.refundId}`, `Credit note ${note.number}`, note.invoiceId, note.branchId, { taxable: -note.taxableTotal, cgst: -note.cgstTotal, sgst: -note.sgstTotal, igst: -(note.igstTotal ?? 0) });
  }
  for (const advance of advances) {
    const g = advance.gst;
    const number = advance.receiptNumber;
    const parts = (p) => ({ taxable: -p.taxable, cgst: -p.cgst, sgst: -p.sgst, igst: -p.igst });
    compare(`advance:${advance._id}`, `Receipt voucher ${number}`, null, advance.branchId, { taxable: g.taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst });
    for (const refund of advance.refunds) compare(`advancerefund:${refund.paymentId}`, `Refund voucher ${refund.number}`, null, advance.branchId, parts(refund));
    if (advance.reversedAt) compare(`advancereverse:${advance._id}`, `Reversal of receipt voucher ${number}`, null, advance.branchId, parts(g));
    const myUses = uses.filter((u) => String(u.advanceId) === String(advance._id));
    for (const u of myUses) compare(`advanceuse:${u._id}`, `Advance ${number} used on a bill`, u.invoiceId, advance.branchId, parts(u.advanceTax ?? {}));
    // The money and the tax must both add up: what was taken = used + given back + what is left
    const taken = myUses.reduce((sum, u) => sum + u.amount, 0) + advance.givenBack + advance.remaining;
    const tax = (u) => (u?.cgst ?? 0) + (u?.sgst ?? 0) + (u?.igst ?? 0);
    const taxTaken = myUses.reduce((sum, u) => sum + tax(u.advanceTax), 0) + advance.refunds.reduce((sum, r) => sum + tax(r), 0) + g.leftCgst + g.leftSgst + g.leftIgst;
    if (!advance.reversedAt && (taken !== advance.amount || taxTaken !== g.cgst + g.sgst + g.igst)) {
      differences.push({ key: `advancebalance:${advance._id}`, code: 'ADVANCE_DOES_NOT_ADD_UP', message: `Receipt voucher ${number} doesn’t add up: what was used, given back and left isn’t what was taken.`, branchId: advance.branchId, link: `/app/advances/${advance._id}` });
    }
  }
  for (const entry of entries) {
    if (!used.has(entry.sourceKey)) add(entry.sourceKey, 'SOURCE_MISSING', `The tax record has ${entry.documentNumber}, but no matching bill or credit note was found.`, null, entry.invoiceId, entry.branchId);
  }
  return differences;
}

// Runs one salon's check, saves it, and rings the bell for anything new
export async function runTaxCheck(orgId, { now = new Date() } = {}) {
  const settings = await BillingSettings.findOne({ orgId }).lean();
  if (settings?.gst?.status !== 'ACTIVE' || !settings.gst.startMonth) return null;

  await addOlderDocuments(orgId, settings);
  const { bills, voids, notes, advances, uses } = await documentsInScope(orgId, settings);
  const [entries, registrations, refunds, previous] = await Promise.all([
    GstTaxEntry.find({ orgId }).select('sourceKey documentNumber invoiceId branchId taxable cgst sgst igst total').lean(),
    GstRegistration.find({ orgId }).lean(),
    Refund.find({ _id: { $in: notes.map((n) => n.note.refundId) } }).select('_id').lean(),
    GstCheck.findOne({ orgId }).lean(),
  ]);
  const differences = compareDocuments({ bills, voids, notes, advances, uses, refundsById: new Map(refunds.map((r) => [String(r._id), r])), registrations, entries });
  const checked = bills.length + voids.length + notes.length + advances.length;

  const before = new Set((previous?.differences ?? []).map((d) => d.key));
  const fresh = differences.filter((d) => !before.has(d.key));
  await GstCheck.updateOne(
    { orgId },
    { $set: { ranAt: now, checked, differences, ranOn: DateTime.fromJSDate(now, { zone: 'Asia/Kolkata' }).toISODate() } },
    { upsert: true }
  );
  if (fresh.length > 0) {
    const owners = await User.find({ orgId, role: 'OWNER', status: 'active', allBranches: true }).distinct('_id');
    await notify({ orgId, userId: null }, owners, { message: `GST check: ${fresh.length} difference${fresh.length === 1 ? '' : 's'} between your bills and the tax record. Please review.`, link: '/app/gst' });
  }
  return { checked, differences };
}

// ---- the night timer ------------------------------------------------------

const EVERY_MS = 15 * 60 * 1000;
const FROM_HOUR = 2; // 2 am in India

// Takes tonight's run for a salon, or false if it has run (or another server just took it)
async function claimTonight(orgId, today) {
  try {
    return Boolean(await GstCheck.findOneAndUpdate({ orgId, ranOn: { $ne: today } }, { $set: { ranOn: today } }, { upsert: true, returnDocument: 'after' }).lean());
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

export async function runDueChecks(now = new Date()) {
  const local = DateTime.fromJSDate(now, { zone: 'Asia/Kolkata' });
  if (local.hour < FROM_HOUR) return 0;
  const salons = await BillingSettings.find({ 'gst.status': 'ACTIVE' }).distinct('orgId');
  let ran = 0;
  for (const orgId of salons) {
    try {
      if (await claimTonight(orgId, local.toISODate())) {
        await runTaxCheck(orgId, { now });
        ran += 1;
      }
    } catch (err) {
      console.error(`GST check failed for salon ${orgId}:`, err.message);
    }
  }
  return ran;
}

export function startGstChecks() {
  setInterval(() => runDueChecks().catch((err) => console.error('GST checks failed:', err.message)), EVERY_MS).unref();
}
