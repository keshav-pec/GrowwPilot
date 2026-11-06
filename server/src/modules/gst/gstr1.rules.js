// Builds a GSTR-1 from the tax record. Pure functions (no database). Every entry ends up in a table or listed as
// excluded, exactly once, and every figure keeps the entries behind it.
import { isValidGstin, GST_STATES } from '../../config/billing.js';
import { formatMoney } from '../../utils/money.js';
import { GST_SETUP_LINK } from '../../config/gst.js';
import { DOC_KINDS } from './gstr1.format.js';

// The grouping rules change over time, so each return keeps the ones of its month.
// B2C large: an invoice to another state above this value. Table 12 split and Table 13 apply from May 2025.
export function rulesFor(period) {
  if (period < '2025-05') return null; // months before the Table 12 split aren't supported
  return { version: '2025-05', b2cLargeAbovePaise: 10000000, table12Split: true, table13Required: true };
}

const blank = () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0 });
const addTo = (target, from, sign = 1) => {
  for (const key of ['taxable', 'cgst', 'sgst', 'igst']) target[key] += sign * (from[key] ?? 0);
  return target;
};
const billLink = (entry) => (entry.invoiceId ? `/app/invoices/${entry.invoiceId}` : `/app/advances/${entry.advanceId}`);
const positive = (rows) => rows.map((r) => ({ rateBps: r.rateBps, taxable: Math.abs(r.taxable), cgst: Math.abs(r.cgst), sgst: Math.abs(r.sgst), igst: Math.abs(r.igst) }));

// An entry's lines by rate
function byRate(lines) {
  const rows = new Map();
  for (const line of lines) {
    if (!rows.has(line.rateBps)) rows.set(line.rateBps, { rateBps: line.rateBps, ...blank() });
    addTo(rows.get(line.rateBps), line);
  }
  return [...rows.values()].sort((a, b) => a.rateBps - b.rateBps);
}

// input: { gstin, entries (this month's, for this GSTIN), voidedInvoiceIds (bills voided by the cutoff), originals (Map of invoiceId -> its bill entry),
//          codeOf(line, entry), unitOf(line, entry), describe(line): the words for Table 12, plainAdvanceTaken (paise), today, period, rules,
//          correction: true for a GSTR-1A holding only what was left out }
// -> { tables (paise), lineage, excluded, issues, totals }
export function buildGstr1({ entries, voidedInvoiceIds, originals, codeOf, unitOf, describe = (line) => line.name, plainAdvanceTaken = 0, rules, period, today, correction = false }) {
  const issues = [];
  const block = (code, message, link, extra = {}) => issues.push({ severity: 'BLOCKER', code, message, link, ...extra });
  const warn = (code, message, link, extra = {}) => issues.push({ severity: 'WARNING', code, message, link, ...extra });
  const lineage = new Map();
  const trace = (table, row, entry) => {
    const key = `${table}:${row}`;
    if (!lineage.has(key)) lineage.set(key, { row: key, table, entryIds: [] });
    const list = lineage.get(key).entryIds;
    if (!list.some((id) => String(id) === String(entry._id))) list.push(entry._id);
  };
  const excluded = [];
  const included = new Set();

  const b2b = new Map();
  const b2cl = new Map();
  const b2cs = new Map();
  const cdnr = new Map();
  const cdnur = [];
  const at = new Map();
  const txpd = new Map();
  const hsn = new Map();
  const docs = { invoice: [], creditNote: [], receiptVoucher: [], refundVoucher: [] };
  const missingUnits = new Map();
  const shortCodes = new Map();

  const isLarge = (entry) => !entry.buyer?.gstin && entry.interstate && entry.total > rules.b2cLargeAbovePaise;

  function checkDocument(entry) {
    const number = entry.documentNumber;
    if (!entry.placeOfSupply?.stateCode || !GST_STATES[entry.placeOfSupply.stateCode]) block('PLACE_OF_SUPPLY_UNRESOLVED', `${number} has no place of supply.`, billLink(entry), { documentNumber: number });
    if (entry.buyer?.gstin && !isValidGstin(entry.buyer.gstin)) block('BUYER_GSTIN_INVALID', `${number} has the customer GSTIN ${entry.buyer.gstin}, which doesn’t look right.`, billLink(entry), { documentNumber: number });
    if (number.length > 16) block('NUMBER_TOO_LONG', `${number} is longer than the 16 characters a GST number can have.`, billLink(entry), { documentNumber: number });
    for (const line of entry.lines) {
      if (!line.rateBps) block('NIL_RATED_NOT_SUPPORTED', `${number}: ${line.name} is at 0%. Nil-rated and exempt sales aren’t supported in the return yet.`, billLink(entry), { documentNumber: number });
    }
  }

  // Table 12: bills add, credit notes take off. Advances aren't in it.
  function addToHsn(entry, sign) {
    const section = entry.buyer?.gstin ? 'B2B' : 'B2C';
    for (const line of entry.lines) {
      const code = codeOf(line, entry);
      if (!code) {
        block('CODE_MISSING', `${entry.documentNumber}: ${line.name} has no ${line.kind === 'PRODUCT' ? 'HSN' : 'SAC'} code. Link it to a tax rule, then rebuild.`, billLink(entry), { documentNumber: entry.documentNumber, table: 'hsn' });
        continue;
      }
      const service = code.startsWith('99');
      const unit = service ? 'NA' : unitOf(line, entry);
      if (!unit) {
        const name = `HSN_UQC_MISSING:${line.name}`;
        missingUnits.set(name, { name: line.name, documents: [...(missingUnits.get(name)?.documents ?? []), entry.documentNumber] });
        continue;
      }
      if (code.length < 6) shortCodes.set(code, line.name);
      const key = `${section}|${code}|${line.rateBps}|${unit}`;
      if (!hsn.has(key)) hsn.set(key, { section, code, rateBps: line.rateBps, unit, description: describe(line), qty: 0, ...blank() });
      const row = hsn.get(key);
      addTo(row, line);
      if (!service) row.qty += sign * (line.qty ?? 0);
      trace('hsn', key, entry);
    }
  }

  const addB2cs = (entry) => {
    const pos = entry.placeOfSupply?.stateCode;
    const supply = entry.interstate ? 'INTER' : 'INTRA';
    for (const r of byRate(entry.lines)) {
      const key = `${pos}|${r.rateBps}|${supply}`;
      if (!b2cs.has(key)) b2cs.set(key, { pos, rateBps: r.rateBps, supply, ...blank() });
      addTo(b2cs.get(key), r);
      trace('b2cs', key, entry);
    }
  };

  const advanceRow = (map, table, entry) => {
    const pos = entry.placeOfSupply?.stateCode;
    const supply = entry.interstate ? 'INTER' : 'INTRA';
    const key = `${pos}|${supply}`;
    if (!map.has(key)) map.set(key, { pos, supply, rates: new Map() });
    const row = map.get(key);
    for (const r of positive(byRate(entry.lines))) {
      if (!row.rates.has(r.rateBps)) row.rates.set(r.rateBps, { rateBps: r.rateBps, ...blank() });
      addTo(row.rates.get(r.rateBps), r);
    }
    trace(table, key, entry);
  };

  for (const entry of entries) {
    const number = entry.documentNumber;
    const exclude = (reason) => excluded.push({ entryId: entry._id, documentNumber: number, reason });
    const use = () => included.add(String(entry._id));

    if (entry.type === 'BILL_ISSUED') {
      const voided = voidedInvoiceIds.has(String(entry.invoiceId));
      docs.invoice.push({ number, cancelled: voided, entry });
      if (voided) {
        exclude('The bill was voided, so it only counts in Table 13 as cancelled');
        continue;
      }
      checkDocument(entry);
      use();
      const items = byRate(entry.lines);
      const invoice = { entryId: entry._id, invoiceId: entry.invoiceId, number, date: entry.taxDate, total: entry.total, pos: entry.placeOfSupply?.stateCode, items };
      if (entry.buyer?.gstin) {
        if (!b2b.has(entry.buyer.gstin)) b2b.set(entry.buyer.gstin, { ctin: entry.buyer.gstin, legalName: entry.buyer.legalName, invoices: [] });
        b2b.get(entry.buyer.gstin).invoices.push(invoice);
        trace('b2b', number, entry);
      } else if (isLarge(entry)) {
        if (!b2cl.has(invoice.pos)) b2cl.set(invoice.pos, { pos: invoice.pos, invoices: [] });
        b2cl.get(invoice.pos).invoices.push(invoice);
        trace('b2cl', number, entry);
      } else {
        addB2cs(entry);
      }
      addToHsn(entry, 1);
    } else if (entry.type === 'BILL_VOIDED') {
      if (!originals.has(String(entry.invoiceId))) {
        block('VOID_WITHOUT_BILL', `${number} was voided, but its bill isn’t in the tax record. Please check with your tax person.`, billLink(entry), { documentNumber: number });
        use();
        continue;
      }
      exclude('A void: the bill it cancels is left out of the tables');
    } else if (entry.type === 'CREDIT_NOTE') {
      docs.creditNote.push({ number, cancelled: false, entry });
      checkDocument(entry);
      use();
      const items = positive(byRate(entry.lines));
      const note = { entryId: entry._id, invoiceId: entry.invoiceId, number, date: entry.taxDate, total: Math.abs(entry.total), pos: entry.placeOfSupply?.stateCode, items };
      const original = originals.get(String(entry.invoiceId));
      if (entry.buyer?.gstin) {
        if (!cdnr.has(entry.buyer.gstin)) cdnr.set(entry.buyer.gstin, { ctin: entry.buyer.gstin, legalName: entry.buyer.legalName, notes: [] });
        cdnr.get(entry.buyer.gstin).notes.push(note);
        trace('cdnr', number, entry);
      } else if (original && isLarge(original)) {
        cdnur.push(note);
        trace('cdnur', number, entry);
      } else {
        // A credit note on an ordinary consumer bill comes off that month's consumer sales
        addB2cs(entry);
      }
      addToHsn(entry, -1);
    } else if (entry.type === 'ADVANCE_RECEIVED') {
      docs.receiptVoucher.push({ number, cancelled: false, entry });
      checkDocument(entry);
      use();
      advanceRow(at, 'at', entry);
    } else {
      // Used on a bill, given back or reversed: all take the advance's tax off through Table 11B
      if (entry.type === 'ADVANCE_REFUNDED') docs.refundVoucher.push({ number, cancelled: false, entry });
      if (entry.type !== 'ADVANCE_USED') warn('ADVANCE_RETURNED', `${number}: unused advance money went back, and this return takes its tax off in Table 11B. Please check this with your tax person.`, billLink(entry), { documentNumber: number });
      use();
      advanceRow(txpd, 'txpd', entry);
    }
  }

  for (const { name, documents } of missingUnits.values()) {
    const more = documents.length > 1 ? ` and ${documents.length - 1} more` : '';
    block('HSN_UQC_MISSING', `${name} has no official unit code (on ${documents[0]}${more}). Choose one for its unit in GST settings, then rebuild.`, GST_SETUP_LINK, { documentNumber: documents[0], table: 'hsn' });
  }
  for (const [code, name] of shortCodes) warn('CODE_SHORT', `${name} uses the code ${code}. Returns usually need at least 6 digits: please check with your tax person.`, undefined, { table: 'hsn' });

  const b2csRows = [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rateBps - b.rateBps);
  for (const row of b2csRows) {
    if (row.taxable < 0) warn('B2CS_NEGATIVE', `Consumer sales in ${GST_STATES[row.pos] ?? row.pos} at ${row.rateBps / 100}% are below zero this month, because of credit notes. The GST portal may not accept this: please check with your tax person.`, undefined, { table: 'b2cs' });
  }
  const hsnRows = [...hsn.values()].sort((a, b) => a.code.localeCompare(b.code) || a.rateBps - b.rateBps);
  for (const row of hsnRows) {
    if (row.qty < 0 || row.taxable < 0) warn('HSN_NEGATIVE', `Table 12 for ${row.code} is below zero this month, because of credit notes. The GST portal may not accept this: please check with your tax person.`, undefined, { table: 'hsn' });
  }

  const advanceRows = (map) => [...map.values()].map((r) => ({ pos: r.pos, supply: r.supply, items: [...r.rates.values()].sort((a, b) => a.rateBps - b.rateBps) }));
  const series = (list, kind) => {
    const groups = new Map();
    for (const doc of [...list].sort((a, b) => a.number.localeCompare(b.number))) {
      const name = doc.number.replace(/\d+$/, '');
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(doc);
    }
    const seen = new Set();
    for (const doc of list) {
      if (seen.has(doc.number)) block('DUPLICATE_DOCUMENT', `${doc.number} appears twice in this month.`, billLink(doc.entry), { documentNumber: doc.number, table: 'documents' });
      seen.add(doc.number);
      trace('documents', `${kind}`, doc.entry);
    }
    return { kind, series: [...groups.values()].map((docsInSeries) => ({ from: docsInSeries[0].number, to: docsInSeries.at(-1).number, total: docsInSeries.length, cancelled: docsInSeries.filter((d) => d.cancelled).length })) };
  };
  const documents = [series(docs.invoice, DOC_KINDS.invoice), series(docs.creditNote, DOC_KINDS.creditNote), series(docs.receiptVoucher, DOC_KINDS.receiptVoucher), series(docs.refundVoucher, DOC_KINDS.refundVoucher)].filter((d) => d.series.length > 0);

  const tables = {
    b2b: [...b2b.values()],
    b2cl: [...b2cl.values()],
    b2cs: b2csRows,
    cdnr: [...cdnr.values()],
    cdnur,
    at: advanceRows(at),
    txpd: advanceRows(txpd),
    hsnB2b: hsnRows.filter((r) => r.section === 'B2B'),
    hsnB2c: hsnRows.filter((r) => r.section === 'B2C'),
    documents,
  };

  // What the tables add up to, and what the record says: there must be no difference
  const inTables = blank();
  const sumItems = (items, sign) => items.forEach((i) => addTo(inTables, i, sign));
  for (const g of [...tables.b2b, ...tables.b2cl]) g.invoices.forEach((inv) => sumItems(inv.items, 1));
  tables.b2cs.forEach((r) => addTo(inTables, r));
  for (const g of tables.cdnr) g.notes.forEach((n) => sumItems(n.items, -1));
  tables.cdnur.forEach((n) => sumItems(n.items, -1));
  tables.at.forEach((r) => sumItems(r.items, 1));
  tables.txpd.forEach((r) => sumItems(r.items, -1));

  const inRecord = blank();
  for (const entry of entries.filter((e) => included.has(String(e._id)))) addTo(inRecord, entry);
  const different = ['taxable', 'cgst', 'sgst', 'igst'].some((key) => inTables[key] !== inRecord[key]);
  if (different) block('RETURN_TOTALS_DIFFERENT', 'The tables don’t add up to the tax record. Please rebuild, and contact support if this stays.', undefined);

  // Every entry exactly once: in a table, or listed as left out
  const excludedIds = new Set(excluded.map((e) => String(e.entryId)));
  for (const entry of entries) {
    if (included.has(String(entry._id)) === excludedIds.has(String(entry._id))) block('ENTRY_NOT_ACCOUNTED', `${entry.documentNumber} isn’t accounted for exactly once.`, billLink(entry), { documentNumber: entry.documentNumber });
  }

  if (plainAdvanceTaken > 0) warn('PLAIN_ADVANCE', `${formatMoney(plainAdvanceTaken)} of plain advances or extra money was taken this month with no tax on it. Your tax person should confirm that is right.`, '/app/gst?tab=advances');
  if (!correction && today.slice(0, 7) <= period) warn('MONTH_NOT_OVER', 'This month isn’t over yet, so more bills may come. Rebuild before you file.', undefined);
  if (entries.length === 0) warn('NOTHING_THIS_MONTH', 'The tax record has nothing for this GSTIN this month.', undefined);

  const totals = { ...inTables, tax: inTables.cgst + inTables.sgst + inTables.igst, total: inTables.taxable + inTables.cgst + inTables.sgst + inTables.igst, record: { ...inRecord } };
  return { tables, lineage: [...lineage.values()], excluded, issues, totals };
}
