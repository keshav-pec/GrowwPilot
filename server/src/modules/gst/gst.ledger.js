// The permanent tax record. Billing calls this inside its own transaction, so a bill and its entry
// are saved together or not at all. The same event twice gives the one entry it already has.
import { DateTime } from 'luxon';
import { Branch, CreditNote, GstRegistration, GstTaxEntry, Invoice, Refund } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { registrationFor } from './gst.rules.js';

const INDIA = 'Asia/Kolkata';
const localDay = (date, zone) => DateTime.fromJSDate(new Date(date), { zone }).toISODate();
// Bills from before GST setup have no place of supply saved: they were charged CGST and SGST in the branch's state
const place = (invoice) => {
  const { stateCode, stateName } = invoice.placeOfSupply?.stateCode ? invoice.placeOfSupply : (invoice.seller ?? {});
  return stateCode ? { stateCode, stateName } : undefined;
};

const sumOf = (lines, field) => lines.reduce((total, l) => total + (l[field] ?? 0), 0);

// The parts every entry shares: who, where, when, and the totals of its lines
function entry(invoice, { type, sourceKey, documentNumber, taxDate, lines, actor, ...rest }) {
  const [taxable, cgst, sgst, igst] = ['taxable', 'cgst', 'sgst', 'igst'].map((field) => sumOf(lines, field));
  return {
    orgId: invoice.orgId,
    branchId: invoice.branchId,
    type,
    sourceKey,
    invoiceId: invoice._id,
    documentNumber,
    invoiceNumber: invoice.invoiceNumber,
    taxDate,
    period: taxDate.slice(0, 7),
    gstin: invoice.seller.gstin,
    legalName: invoice.seller.legalName,
    customerName: invoice.customerSnapshot?.name,
    buyer: invoice.buyer?.gstin ? { gstin: invoice.buyer.gstin, legalName: invoice.buyer.legalName } : undefined,
    placeOfSupply: place(invoice),
    interstate: Boolean(invoice.interstate),
    lines,
    taxable,
    cgst,
    sgst,
    igst,
    tax: cgst + sgst + igst,
    total: taxable + cgst + sgst + igst,
    createdBy: actor?.userId,
    createdByName: actor?.userName,
    ...rest,
  };
}

const billLine = (sign) => (l) => ({
  lineId: l._id,
  kind: l.kind,
  name: l.name,
  code: l.sacCode ?? l.hsnCode,
  qty: l.qty,
  rateBps: l.taxRateBps,
  taxRuleId: l.taxRuleId ?? undefined,
  itcType: l.itcType,
  taxable: sign * l.taxableAmount,
  cgst: sign * l.cgst,
  sgst: sign * l.sgst,
  igst: sign * (l.igst ?? 0),
  total: sign * l.lineTotal,
});

export const billTaxDate = (invoice, zone) => invoice.taxDate ?? localDay(invoice.issuedAt, zone);

function billEntry(invoice, { taxDate, actor, addedLater }) {
  return entry(invoice, { type: 'BILL_ISSUED', sourceKey: `bill:${invoice._id}`, documentNumber: invoice.invoiceNumber, taxDate, lines: invoice.lines.map(billLine(1)), actor, addedLater });
}

function voidEntry(invoice, { taxDate, actor, addedLater, originalEntryId }) {
  return entry(invoice, { type: 'BILL_VOIDED', sourceKey: `void:${invoice._id}`, documentNumber: invoice.invoiceNumber, taxDate, lines: invoice.lines.map(billLine(-1)), actor, addedLater, originalEntryId });
}

function creditNoteEntry(invoice, note, refund, { taxDate, actor, addedLater, originalEntryId }) {
  const lines = refund.lines.map((l) => {
    const line = invoice.lines.find((x) => String(x._id) === String(l.lineId));
    return {
      lineId: l.lineId,
      kind: l.kind,
      name: l.name,
      code: line?.sacCode ?? line?.hsnCode,
      qty: l.qty,
      rateBps: l.taxRateBps,
      taxRuleId: line?.taxRuleId ?? undefined,
      itcType: line?.itcType,
      taxable: -l.taxableAmount,
      cgst: -l.cgst,
      sgst: -l.sgst,
      igst: -(l.igst ?? 0),
      total: -l.amount,
    };
  });
  return entry(invoice, { type: 'CREDIT_NOTE', sourceKey: `creditnote:${refund._id}`, documentNumber: note.number, refundId: refund._id, taxDate, lines, actor, addedLater, originalEntryId });
}

async function saveOnce(doc, session) {
  const existing = await GstTaxEntry.findOne({ orgId: doc.orgId, sourceKey: doc.sourceKey }).session(session).lean();
  if (existing) return existing;
  const [created] = await GstTaxEntry.create([doc], { session });
  return created.toObject();
}

// Does this event belong in the record? A GST document, at a salon with GST setup active, from its start month on.
function inRecord(settings, invoice, taxDate) {
  return settings.gst?.status === 'ACTIVE' && invoice.gstRegistered && Boolean(invoice.seller?.gstin) && taxDate.slice(0, 7) >= settings.gst.startMonth;
}

const actorOf = (ctx) => ({ userId: ctx.userId, userName: ctx.userName });

// The bill's GSTIN must be the one its branch had on that date, or the bill would land in another GSTIN's return
export function assertSellerMatches(invoice, registration) {
  if (registration?.gstin !== invoice.seller?.gstin) {
    throw new AppError(409, 'REGISTRATION_MISMATCH', `Bill ${invoice.invoiceNumber} is under GSTIN ${invoice.seller?.gstin ?? '(none)'}, but its branch had ${registration?.gstin ?? 'no GSTIN'} on that date.`);
  }
}

export async function postBill(ctx, invoice, settings, { taxDate }, session) {
  if (!inRecord(settings, invoice, taxDate)) return null;
  const registrations = await GstRegistration.find({ orgId: invoice.orgId }).session(session).lean();
  assertSellerMatches(invoice, registrationFor(registrations, invoice.branchId, taxDate));
  return saveOnce(billEntry(invoice, { taxDate, actor: actorOf(ctx) }), session);
}

const originalOf = async (invoice, session) => (await GstTaxEntry.findOne({ orgId: invoice.orgId, sourceKey: `bill:${invoice._id}` }).select('_id').session(session).lean())?._id;

export async function postVoid(ctx, invoice, settings, { taxDate }, session) {
  if (!inRecord(settings, invoice, taxDate)) return null;
  return saveOnce(voidEntry(invoice, { taxDate, actor: actorOf(ctx), originalEntryId: await originalOf(invoice, session) }), session);
}

export async function postCreditNote(ctx, invoice, note, refund, settings, { taxDate }, session) {
  if (!inRecord(settings, invoice, taxDate)) return null;
  return saveOnce(creditNoteEntry(invoice, note, refund, { taxDate, actor: actorOf(ctx), originalEntryId: await originalOf(invoice, session) }), session);
}

// ---------------------------------------------------------------------------
// Older documents: everything before the salon's record began (settings.gst.recordFrom), from its start month on,
// is added once. A bill whose GSTIN doesn't match its branch's registration is left out; the nightly check lists it.
// Each entry stands alone and the unique index keeps it once, so this can stop and start again at any point.
// ---------------------------------------------------------------------------
async function zones(orgId) {
  const branches = await Branch.find({ orgId }).select('timezone').lean();
  return new Map(branches.map((b) => [String(b._id), b.timezone]));
}

// The first moment that could be in the start month, in any time zone
const startOfScope = (startMonth) => DateTime.fromISO(`${startMonth}-01`, { zone: 'utc' }).minus({ days: 1 }).toJSDate();

// Every document in scope for a salon, with its day. Used by this and by the nightly check.
export async function documentsInScope(orgId, settings, { before = null } = {}) {
  const zoneOf = await zones(orgId);
  const startMonth = settings.gst.startMonth;
  const since = startOfScope(startMonth);
  const until = before ? { $lt: before } : undefined;
  const dayOf = (date, branchId) => localDay(date, zoneOf.get(String(branchId)) ?? INDIA);
  const inScope = (taxDate) => taxDate.slice(0, 7) >= startMonth;

  const billQuery = { orgId, gstRegistered: true, status: { $in: ['ISSUED', 'VOID'] }, issuedAt: { $gte: since, ...until } };
  const bills = (await Invoice.find(billQuery).lean()).map((invoice) => ({ invoice, taxDate: invoice.taxDate ?? dayOf(invoice.issuedAt, invoice.branchId) })).filter((b) => b.invoice.seller?.gstin && inScope(b.taxDate));

  const voidQuery = { orgId, gstRegistered: true, status: 'VOID', voidedAt: { $gte: since, ...until } };
  const voids = (await Invoice.find(voidQuery).lean()).map((invoice) => ({ invoice, taxDate: dayOf(invoice.voidedAt, invoice.branchId) })).filter((v) => v.invoice.seller?.gstin && inScope(v.taxDate));

  const notes = (await CreditNote.find({ orgId, issuedAt: { $gte: since, ...until } }).lean()).map((note) => ({ note, taxDate: dayOf(note.issuedAt, note.branchId) })).filter((n) => inScope(n.taxDate));
  return { bills, voids, notes };
}

export async function addOlderDocuments(orgId, settings) {
  if (settings.gst?.status !== 'ACTIVE' || !settings.gst.startMonth || !settings.gst.recordFrom) return { added: 0 };
  const { bills, voids, notes } = await documentsInScope(orgId, settings, { before: settings.gst.recordFrom });
  const registrations = await GstRegistration.find({ orgId }).lean();
  const seen = new Set(await GstTaxEntry.find({ orgId }).distinct('sourceKey'));
  const missing = (key) => !seen.has(key);
  const later = { addedLater: true };

  const billDocs = bills
    .filter(({ invoice, taxDate }) => missing(`bill:${invoice._id}`) && registrationFor(registrations, invoice.branchId, taxDate)?.gstin === invoice.seller.gstin)
    .map(({ invoice, taxDate }) => billEntry(invoice, { taxDate, ...later }));
  let added = await insertNew(billDocs);

  // Minus entries link to the bill entries that now exist
  const originals = new Map((await GstTaxEntry.find({ orgId, type: 'BILL_ISSUED' }).select('invoiceId').lean()).map((e) => [String(e.invoiceId), e._id]));
  const originalEntryId = (invoice) => originals.get(String(invoice._id));
  const voidDocs = voids.filter(({ invoice }) => missing(`void:${invoice._id}`)).map(({ invoice, taxDate }) => voidEntry(invoice, { taxDate, ...later, originalEntryId: originalEntryId(invoice) }));

  const refundsOf = new Map((await Refund.find({ _id: { $in: notes.map((n) => n.note.refundId) } }).lean()).map((r) => [String(r._id), r]));
  const invoicesOf = new Map((await Invoice.find({ _id: { $in: notes.map((n) => n.note.invoiceId) } }).lean()).map((i) => [String(i._id), i]));
  const noteDocs = notes
    .filter(({ note }) => missing(`creditnote:${note.refundId}`) && refundsOf.has(String(note.refundId)) && invoicesOf.get(String(note.invoiceId))?.seller?.gstin)
    .map(({ note, taxDate }) => {
      const invoice = invoicesOf.get(String(note.invoiceId));
      return creditNoteEntry(invoice, note, refundsOf.get(String(note.refundId)), { taxDate, ...later, originalEntryId: originalEntryId(invoice) });
    });
  added += await insertNew([...voidDocs, ...noteDocs]);
  return { added };
}

// Adds what isn't there yet. A row another server just added is simply skipped.
async function insertNew(docs) {
  if (docs.length === 0) return 0;
  try {
    return (await GstTaxEntry.insertMany(docs, { ordered: false })).length;
  } catch (err) {
    if (err.code === 11000) return err.insertedDocs?.length ?? err.result?.insertedCount ?? 0;
    throw err;
  }
}
