// The GSTR-1 file layout, in one place so it can be changed in one place.
//
// GSTN doesn't publish this layout openly. It is written from public community notes on the GST offline tool's files
// (offline tool 3.2.x). It has NOT yet been checked against the tool or the portal: a real upload is still to be done.
// Amounts are rupees with up to 2 decimals, dates are DD-MM-YYYY, and doc_num numbers follow the tool's document list.
import { z } from 'zod';

export const GSTR1_FORMAT = { version: 'GST3.2.4', checkedAgainstPortal: false };

// Document kinds in Table 13
export const DOC_KINDS = { invoice: 1, creditNote: 5, receiptVoucher: 6, refundVoucher: 8 };

const money = z.number().refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Up to 2 decimals');
const moneyUp = money.refine((v) => v >= 0, 'Can’t be below zero');
const date = z.string().regex(/^\d{2}-\d{2}-\d{4}$/);
const state = z.string().regex(/^\d{2}$/);
const gstin = z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
const docNumber = z.string().min(1).max(16).regex(/^[A-Za-z0-9/-]+$/);

const itemDetail = z.object({ rt: z.number().min(0), txval: moneyUp, iamt: moneyUp, camt: moneyUp.optional(), samt: moneyUp.optional(), csamt: moneyUp }).strict();
const item = z.object({ num: z.number().int().min(1), itm_det: itemDetail }).strict();
const invoice = z.object({ inum: docNumber, idt: date, val: moneyUp, pos: state, rchrg: z.literal('N'), inv_typ: z.literal('R'), itms: z.array(item).min(1) }).strict();
const note = z.object({ ntty: z.literal('C'), nt_num: docNumber, nt_dt: date, val: moneyUp, pos: state, rchrg: z.literal('N'), inv_typ: z.literal('R'), itms: z.array(item).min(1) }).strict();
const unregisteredNote = z.object({ typ: z.literal('B2CL'), ntty: z.literal('C'), nt_num: docNumber, nt_dt: date, val: moneyUp, pos: state, itms: z.array(item).min(1) }).strict();
const advanceRow = z
  .object({
    pos: state,
    sply_ty: z.enum(['INTER', 'INTRA']),
    itms: z.array(z.object({ rt: z.number().min(0), ad_amt: moneyUp, iamt: moneyUp, camt: moneyUp, samt: moneyUp, csamt: moneyUp }).strict()).min(1),
  })
  .strict();
const hsnRow = z
  .object({ num: z.number().int().min(1), hsn_sc: z.string().regex(/^\d{4,8}$/), desc: z.string().min(1).max(30), uqc: z.string().min(2).max(3), qty: z.number(), rt: z.number().min(0), txval: money, iamt: money, camt: money, samt: money, csamt: money })
  .strict()
  .refine((r) => !r.hsn_sc.startsWith('99') || (r.uqc === 'NA' && r.qty === 0), 'A service has the unit NA and no quantity');

const schema = z
  .object({
    gstin,
    fp: z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/),
    version: z.string(),
    hash: z.string(),
    b2b: z.array(z.object({ ctin: gstin, inv: z.array(invoice).min(1) }).strict()).optional(),
    b2cl: z.array(z.object({ pos: state, inv: z.array(invoice).min(1) }).strict()).optional(),
    b2cs: z.array(z.object({ sply_ty: z.enum(['INTER', 'INTRA']), rt: z.number().min(0), typ: z.literal('OE'), pos: state, txval: money, iamt: money, camt: money, samt: money, csamt: money }).strict()).optional(),
    cdnr: z.array(z.object({ ctin: gstin, nt: z.array(note).min(1) }).strict()).optional(),
    cdnur: z.array(unregisteredNote).optional(),
    at: z.array(advanceRow).optional(),
    txpd: z.array(advanceRow).optional(),
    hsn: z.object({ hsn_b2b: z.array(hsnRow), hsn_b2c: z.array(hsnRow) }).strict(),
    doc_issue: z.object({ doc_det: z.array(z.object({ doc_num: z.number().int(), docs: z.array(z.object({ num: z.number().int().min(1), from: docNumber, to: docNumber, totnum: z.number().int().min(0), cancel: z.number().int().min(0), net_issue: z.number().int().min(0) }).strict()).min(1) }).strict()) }).strict(),
  })
  .strict();

// -> [{ path, message }]: empty when the file fits the layout
export function checkFormat(file) {
  const result = schema.safeParse(file);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

const rupees = (paise) => Math.round(paise) / 100;
const percent = (bps) => bps / 100;
const dmy = (date_) => date_.split('-').reverse().join('-');

function itemsOf(rows) {
  return rows.map((r, i) => ({
    num: i + 1,
    itm_det: { rt: percent(r.rateBps), txval: rupees(r.taxable), iamt: rupees(r.igst), ...(r.igst ? {} : { camt: rupees(r.cgst), samt: rupees(r.sgst) }), csamt: 0 },
  }));
}
const invoiceFile = (inv) => ({ inum: inv.number, idt: dmy(inv.date), val: rupees(inv.total), pos: inv.pos, rchrg: 'N', inv_typ: 'R', itms: itemsOf(inv.items) });
const advanceFile = (row) => ({ pos: row.pos, sply_ty: row.supply, itms: row.items.map((r) => ({ rt: percent(r.rateBps), ad_amt: rupees(r.taxable), iamt: rupees(r.igst), camt: rupees(r.cgst), samt: rupees(r.sgst), csamt: 0 })) });
const hsnFile = (r, i) => ({ num: i + 1, hsn_sc: r.code, desc: r.description.slice(0, 30), uqc: r.unit, qty: r.qty, rt: percent(r.rateBps), txval: rupees(r.taxable), iamt: rupees(r.igst), camt: rupees(r.cgst), samt: rupees(r.sgst), csamt: 0 });
const present = (key, list) => (list.length > 0 ? { [key]: list } : {});

// The tables (in paise) as the file. Empty sections are left out, except Tables 12 and 13.
export function toPortalFile(tables, { gstin: seller, period }) {
  const [year, month] = period.split('-');
  return {
    gstin: seller,
    fp: `${month}${year}`,
    version: GSTR1_FORMAT.version,
    hash: 'hash',
    ...present('b2b', tables.b2b.map((g) => ({ ctin: g.ctin, inv: g.invoices.map(invoiceFile) }))),
    ...present('b2cl', tables.b2cl.map((g) => ({ pos: g.pos, inv: g.invoices.map(invoiceFile) }))),
    ...present('b2cs', tables.b2cs.map((r) => ({ sply_ty: r.supply, rt: percent(r.rateBps), typ: 'OE', pos: r.pos, txval: rupees(r.taxable), iamt: rupees(r.igst), camt: rupees(r.cgst), samt: rupees(r.sgst), csamt: 0 }))),
    ...present('cdnr', tables.cdnr.map((g) => ({ ctin: g.ctin, nt: g.notes.map((n) => ({ ntty: 'C', nt_num: n.number, nt_dt: dmy(n.date), val: rupees(n.total), pos: n.pos, rchrg: 'N', inv_typ: 'R', itms: itemsOf(n.items) })) }))),
    ...present('cdnur', tables.cdnur.map((n) => ({ typ: 'B2CL', ntty: 'C', nt_num: n.number, nt_dt: dmy(n.date), val: rupees(n.total), pos: n.pos, itms: itemsOf(n.items) }))),
    ...present('at', tables.at.map(advanceFile)),
    ...present('txpd', tables.txpd.map(advanceFile)),
    hsn: { hsn_b2b: tables.hsnB2b.map(hsnFile), hsn_b2c: tables.hsnB2c.map(hsnFile) },
    doc_issue: { doc_det: tables.documents.map((d) => ({ doc_num: d.kind, docs: d.series.map((s, i) => ({ num: i + 1, from: s.from, to: s.to, totnum: s.total, cancel: s.cancelled, net_issue: s.total - s.cancelled })) })) },
  };
}
