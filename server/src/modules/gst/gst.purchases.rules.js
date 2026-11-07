// Purchases and input tax credit: reading a GSTR-2B file, matching it with the books, suggesting a credit, and
// the GSTR-3B rows. Pure functions (no database).
import { isValidGstin } from '../../config/billing.js';
import { MATCH_TOLERANCE_PAISE } from '../../config/gst.js';
import { AppError } from '../../utils/AppError.js';

// "INV/0-009 " -> "INV0009"; "000123" -> "123"
export const normalizeNumber = (number) => String(number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=.)/, '');
export const matchKeyOf = (supplierGstin, number) => `${String(supplierGstin).toUpperCase()}|${normalizeNumber(number)}`;

const paise = (rupees) => Math.round(Number(rupees || 0) * 100);
// DD-MM-YYYY -> YYYY-MM-DD; a date already in that form stays
const isoDate = (text) => {
  const t = String(text ?? '').trim();
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : t;
};

function sumItems(doc) {
  const items = doc.items ?? doc.itms ?? [];
  const list = items.length > 0 ? items.map((i) => i.itm_det ?? i) : [doc];
  const add = (...names) => list.reduce((sum, i) => sum + paise(names.map((n) => i[n]).find((v) => v !== undefined)), 0);
  return { taxable: add('txval'), igst: add('igst', 'iamt'), cgst: add('cgst', 'camt'), sgst: add('sgst', 'samt') };
}

// GSTN doesn't publish this file's layout openly, so it is read tolerantly: `b2b` may sit under data.docdata, docdata or data.
// -> { gstin, period ("YYYY-MM") or null, rows }
export function parse2bJson(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new AppError(400, 'FILE_NOT_READABLE', 'This file isn’t valid JSON. Download GSTR-2B as JSON from the portal, or use the CSV layout.');
  }
  const data = file.data ?? file;
  const docs = data.docdata ?? data.docData ?? data;
  const period = /^(\d{2})(\d{4})$/.exec(String(data.rtnprd ?? file.rtnprd ?? ''));
  const rows = [];
  const add = (group, doc, kind, number, date) => {
    const itcAvailable = !['N', 'n', false].includes(doc.itcavl ?? doc.itcAvl ?? 'Y');
    rows.push({ supplierGstin: String(group.ctin ?? '').toUpperCase(), supplierName: group.trdnm ?? group.lglNm ?? '', billNumber: String(number ?? ''), matchKey: matchKeyOf(group.ctin ?? '', number), billDate: isoDate(date), kind, ...sumItems(doc), itcAvailable, reason: doc.rsn ?? undefined, imsStatus: doc.imsStatus ?? doc.ims_status ?? undefined });
  };
  for (const group of docs.b2b ?? []) for (const inv of group.inv ?? []) add(group, inv, 'INVOICE', inv.inum, inv.dt ?? inv.idt);
  for (const group of docs.cdnr ?? docs.cdn ?? []) for (const nt of group.nt ?? []) add(group, nt, 'CREDIT_NOTE', nt.ntnum ?? nt.nt_num, nt.dt ?? nt.nt_dt);
  for (const section of ['b2ba', 'cdnra', 'isd', 'isda', 'ecom', 'ecoma', 'impg', 'impgsez']) {
    for (const group of docs[section] ?? []) for (const doc of group.inv ?? group.nt ?? group.doclist ?? []) add(group, doc, 'OTHER', doc.inum ?? doc.ntnum ?? doc.docnum ?? section, doc.dt ?? doc.docdt);
  }
  return { gstin: data.gstin ?? file.gstin ?? null, period: period ? `${period[2]}-${period[1]}` : null, rows };
}

// One line of CSV, with quoted cells
function csvCells(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell.trim()); cell = ''; } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

export const CSV_2B_HEADER = ['Supplier GSTIN', 'Supplier name', 'Bill number', 'Bill date', 'Taxable', 'IGST', 'CGST', 'SGST'];

// The fallback layout, for when the portal's file can't be read: one bill per row, amounts in rupees
export function parse2bCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = csvCells(lines[0] ?? '').map((h) => h.toLowerCase());
  if (CSV_2B_HEADER.some((name) => !header.includes(name.toLowerCase()))) throw new AppError(400, 'FILE_NOT_READABLE', `The CSV needs these columns: ${CSV_2B_HEADER.join(', ')}`);
  const at = (cells, name) => cells[header.indexOf(name.toLowerCase())] ?? '';
  const rows = lines.slice(1).map((line) => {
    const cells = csvCells(line);
    const supplierGstin = at(cells, 'Supplier GSTIN').toUpperCase();
    const billNumber = at(cells, 'Bill number');
    return { supplierGstin, supplierName: at(cells, 'Supplier name'), billNumber, matchKey: matchKeyOf(supplierGstin, billNumber), billDate: isoDate(at(cells, 'Bill date')), kind: 'INVOICE', taxable: paise(at(cells, 'Taxable')), igst: paise(at(cells, 'IGST')), cgst: paise(at(cells, 'CGST')), sgst: paise(at(cells, 'SGST')), itcAvailable: true };
  });
  return { gstin: null, period: null, rows };
}

export const taxOf = (x) => (x.igst ?? 0) + (x.cgst ?? 0) + (x.sgst ?? 0);

// bills: active bills of the month, oldest first. rows: the current GSTR-2B's rows, or null if none was imported.
// allBills: every active bill in the salon, to catch a duplicate from another month.
// -> grid rows: { key, status, bill, portal, difference, note }
export function matchPurchases(bills, rows, allBills = bills) {
  const grid = [];
  const usedRows = new Set();
  const firstWithKey = new Map();
  for (const bill of [...allBills].sort((a, b) => String(a._id).localeCompare(String(b._id)))) if (!firstWithKey.has(bill.matchKey)) firstWithKey.set(bill.matchKey, String(bill._id));
  const rowsByKey = new Map();
  for (const row of rows ?? []) rowsByKey.set(row.matchKey, [...(rowsByKey.get(row.matchKey) ?? []), row]);
  const numberOnly = (key) => key.split('|')[1];

  for (const bill of bills) {
    const key = bill.matchKey;
    const same = rowsByKey.get(key) ?? [];
    same.forEach(() => usedRows.add(key));
    const base = { key: String(bill._id), bill, portal: same[0] ?? null };
    if (firstWithKey.get(key) !== String(bill._id)) {
      grid.push({ ...base, status: 'DUPLICATE', note: 'The same supplier and bill number is already in your books. Cancel one of them.' });
    } else if (rows === null) {
      grid.push({ ...base, status: 'NOT_CHECKED', note: 'Import GSTR-2B for this month to check this bill.' });
    } else if (same.length === 0) {
      const elsewhere = (rows ?? []).find((r) => numberOnly(r.matchKey) === numberOnly(key));
      grid.push({ ...base, status: elsewhere ? 'REVIEW_REQUIRED' : 'MISSING_IN_2B', portal: elsewhere ?? null, note: elsewhere ? `GSTR-2B has this bill number under another supplier GSTIN, ${elsewhere.supplierGstin}. Check which is right.` : 'This bill isn’t in GSTR-2B. No credit can be claimed until it is.' });
    } else if (same.length > 1) {
      grid.push({ ...base, status: 'REVIEW_REQUIRED', note: 'GSTR-2B has this bill more than once. Your tax person should check it.' });
    } else {
      const portal = same[0];
      const difference = { taxable: bill.taxable - portal.taxable, igst: bill.igst - portal.igst, cgst: bill.cgst - portal.cgst, sgst: bill.sgst - portal.sgst };
      const far = Object.values(difference).some((d) => Math.abs(d) > MATCH_TOLERANCE_PAISE);
      if (far) grid.push({ ...base, status: 'AMOUNT_MISMATCH', difference, note: 'The amounts on your bill and in GSTR-2B are different.' });
      else if (portal.kind !== 'INVOICE') grid.push({ ...base, status: 'REVIEW_REQUIRED', difference, note: 'GSTR-2B shows this as a credit note or amendment. Your tax person should check it.' });
      else if (!portal.itcAvailable) grid.push({ ...base, status: 'REVIEW_REQUIRED', difference, note: `GSTR-2B says credit isn’t available on this bill${portal.reason ? `: ${portal.reason}` : ''}.` });
      else grid.push({ ...base, status: 'MATCHED', difference });
    }
  }
  for (const row of rows ?? []) {
    if (!usedRows.has(row.matchKey)) grid.push({ key: `2b:${row.matchKey}`, status: 'MISSING_IN_BOOKS', bill: null, portal: row, note: 'This is in GSTR-2B but not in your books. Add the bill, or decide not to claim it.' });
  }
  return grid;
}

// What the app suggests. needsDecision: the owner has to choose the amounts themselves.
export function suggestItc(bill) {
  const zero = { igst: 0, cgst: 0, sgst: 0 };
  const all = { igst: bill.igst, cgst: bill.cgst, sgst: bill.sgst };
  if (bill.use === 'NO_ITC_SERVICES') return { eligible: zero, notEligible: all, needsDecision: false, note: 'Used only for services at 5% without ITC, so no credit can be claimed.' };
  if (bill.use === 'RESALE') return { eligible: all, notEligible: zero, needsDecision: true, note: 'Stock for resale can usually be claimed, but it is reviewed on its own. Check with your tax person.' };
  if (bill.use === 'MIXED') return { eligible: null, notEligible: null, needsDecision: true, note: 'Used for both credit and no-credit sales: you decide the split with your tax person.' };
  return { eligible: null, notEligible: null, needsDecision: true, note: 'Decide this with your tax person.' };
}

// Checks an owner's decision on a bill. -> { eligible, notEligible }
export function checkDecision(bill, status, eligible) {
  if (status === 'DUPLICATE') throw new AppError(409, 'DUPLICATE_BILL', 'This bill is a duplicate. Cancel it instead.');
  const claimed = taxOf(eligible);
  if (claimed > 0 && status !== 'MATCHED') throw new AppError(409, 'ITC_POLICY_UNRESOLVED', 'Credit can only be claimed on a bill that matches GSTR-2B.');
  if (claimed > 0 && bill.use === 'NO_ITC_SERVICES') throw new AppError(409, 'ITC_NOT_ALLOWED', 'This bill is marked as used only for services at 5% without ITC, so no credit can be claimed.');
  const notEligible = {};
  for (const head of ['igst', 'cgst', 'sgst']) {
    if (eligible[head] > bill[head]) throw new AppError(400, 'ITC_TOO_HIGH', `The credit can’t be more than the ${head.toUpperCase()} on the bill`);
    notEligible[head] = bill[head] - eligible[head];
  }
  return { eligible, notEligible };
}

export const validSupplierGstin = (gstin) => isValidGstin(String(gstin ?? '').toUpperCase());

// ---- GSTR-3B rows ----------------------------------------------------------
// The rows this month uses. Stored with each sheet, because the form changes over time.
export const WORKSHEET_MAPPING = { version: '2022-10', rows: ['3.1(a)', '3.2', '4A(5)', '4C'] };

export const NOT_CLAIMED_ROW = 'NOT_CLAIMED';

const blank = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const addTo = (target, from) => {
  for (const k of Object.keys(blank())) target[k] += from[k] ?? 0;
  return target;
};

// entries: the month's tax record for this GSTIN, with voided bills and their voids already left out, as in GSTR-1.
// decisions: the decisions that stand for the month.
export function buildWorksheetRows(entries, decisions) {
  const outward = { key: '3.1(a)', table: '3.1', label: 'Outward taxable supplies', ...blank(), entryIds: [] };
  const states = new Map();
  for (const e of entries) {
    addTo(outward, e);
    outward.entryIds.push(e._id);
    if (e.interstate && !e.buyer?.gstin) {
      const pos = e.placeOfSupply?.stateCode;
      if (!states.has(pos)) states.set(pos, { key: `3.2:${pos}`, table: '3.2', label: `Inter-state sales to unregistered customers, ${e.placeOfSupply?.stateName ?? pos}`, ...blank(), entryIds: [] });
      addTo(states.get(pos), e);
      states.get(pos).entryIds.push(e._id);
    }
  }
  const claimed = { key: '4A(5)', table: '4', label: 'All other ITC (approved decisions)', ...blank(), decisionIds: [] };
  // Not a row of the form: what was decided as not claimed, whatever the reason (not eligible, or waiting for the supplier)
  const notClaimed = { key: NOT_CLAIMED_ROW, table: 'memo', label: 'Not claimed this month (for information, not a GSTR-3B row)', ...blank(), decisionIds: [] };
  for (const d of decisions) {
    if (taxOf(d.eligible) > 0) { addTo(claimed, d.eligible); claimed.decisionIds.push(d._id); }
    if (taxOf(d.notEligible) > 0) { addTo(notClaimed, d.notEligible); notClaimed.decisionIds.push(d._id); }
  }
  const net = { key: '4C', table: '4', label: 'Net ITC available', ...blank(), igst: claimed.igst, cgst: claimed.cgst, sgst: claimed.sgst };
  return [outward, ...[...states.values()].sort((a, b) => a.key.localeCompare(b.key)), claimed, net, notClaimed];
}

// Output tax less approved credit, head by head. Before the portal's balances, and it isn't the amount to pay.
export function worksheetSummary(rows) {
  const out = rows.find((r) => r.key === '3.1(a)');
  const itc = rows.find((r) => r.key === '4C');
  const line = (head) => out[head] - itc[head];
  return { outputTax: taxOf(out), taxable: out.taxable, itc: taxOf(itc), notClaimed: taxOf(rows.find((r) => r.key === NOT_CLAIMED_ROW)), afterCredit: { igst: line('igst'), cgst: line('cgst'), sgst: line('sgst') } };
}

// Our row against the portal's, field by field
export function worksheetDifferences(rows, portalRows = {}) {
  const fix = (key) => (key.startsWith('4') ? 'Check the ITC decisions for this month.' : 'Fix the source bill, or correct it through GSTR-1A. Don’t change figures to match.');
  const out = [];
  for (const row of rows.filter((r) => r.table !== 'memo')) {
    const portal = portalRows[row.key];
    if (!portal) continue;
    const difference = Object.fromEntries(Object.keys(blank()).map((k) => [k, row[k] - (portal[k] ?? 0)]));
    if (Object.values(difference).some(Boolean)) out.push({ key: row.key, label: row.label, difference, fix: fix(row.key) });
  }
  return out;
}
