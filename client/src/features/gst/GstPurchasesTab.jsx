import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Download, Plus, Upload } from 'lucide-react';
import { refusalText, useAddPurchase, useCancelPurchase, useDecideItc, useDecideMissing, useGstPurchases, useImport2b } from '../../api/gst';
import { useSuppliers } from '../../api/inventory/suppliers';
import { useReceipts } from '../../api/inventory/purchasing';
import { useAuth } from '../../auth/AuthContext';
import { hasAddon } from '../../lib/constants';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { formatDate, formatDateTime, formatMonth } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Badge, Button, Card, EmptyState, HEADLINE_TILE, Input, Modal, ModalFooter, PageSpinner, Select, StatTile, SummaryRow, Textarea } from '../../components/ui';
import ReasonModal from '../../components/ReasonModal';

const MATCH = {
  MATCHED: { label: 'Matched', tone: 'brown' },
  MISSING_IN_2B: { label: 'Missing in 2B', tone: 'orange' },
  MISSING_IN_BOOKS: { label: 'Missing in books', tone: 'orange' },
  AMOUNT_MISMATCH: { label: 'Amount mismatch', tone: 'danger' },
  DUPLICATE: { label: 'Duplicate', tone: 'danger' },
  REVIEW_REQUIRED: { label: 'Needs review', tone: 'yellow' },
  NOT_CHECKED: { label: 'Not checked', tone: 'neutral' },
};
const USES = [
  { value: 'NO_ITC_SERVICES', label: 'Only for salon services at 5% without ITC' },
  { value: 'RESALE', label: 'Stock for resale' },
  { value: 'MIXED', label: 'Both of these' },
  { value: 'OTHER', label: 'Something else' },
];
const USE_WORDS = Object.fromEntries(USES.map((u) => [u.value, u.label]));
const taxOf = (x) => (x?.igst ?? 0) + (x?.cgst ?? 0) + (x?.sgst ?? 0);
const fail = (err) => toast.error(refusalText(err));
const CSV_LAYOUT = 'Supplier GSTIN,Supplier name,Bill number,Bill date,Taxable,IGST,CGST,SGST\n';

// Supplier bills against GSTR-2B, row by row, and the credit decided on each. A match alone never claims anything.
export default function GstPurchasesTab({ today, initialMonth }) {
  const [month, setMonth] = useState(initialMonth || today.slice(0, 7));
  const [gstin, setGstin] = useState('');
  const [status, setStatus] = useState('');
  const [asking, setAsking] = useState(null); // 'add' | 'import' | { decide: row } | { cancel: bill } | { notClaimed: row }
  const [openRow, setOpenRow] = useState(null);
  const query = useGstPurchases({ gstin: gstin || undefined, period: month });

  if (query.isPending) return <PageSpinner />;
  if (query.isError) return <EmptyState title="Couldn’t load purchases" message={query.error.message} />;
  const data = query.data;
  const canChange = data.canWork && !data.locked && Boolean(data.gstin);
  const rows = data.rows.filter((r) => !status || r.status === status);
  const statusOptions = [{ value: '', label: 'Everything' }, ...Object.entries(MATCH).filter(([key]) => data.summary.counts?.[key]).map(([value, m]) => ({ value, label: `${m.label} (${data.summary.counts[value]})` }))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Input label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="min-w-64">
          <Select label="GSTIN" options={data.gstins.map((g) => ({ value: g.gstin, label: g.gstin }))} value={data.gstin ?? ''} onChange={(e) => setGstin(e.target.value)} />
        </div>
        <Select label="Show" options={statusOptions} value={status} onChange={(e) => setStatus(e.target.value)} />
        {canChange && (
          <>
            <Button onClick={() => setAsking('add')}><Plus size={16} /> Add bill</Button>
            <Button variant="secondary" onClick={() => setAsking('import')}><Upload size={16} /> Import GSTR-2B</Button>
          </>
        )}
      </div>

      {data.locked && <p className="rounded-lg bg-surface p-3 text-sm text-muted">GSTR-3B for {formatMonth(data.period)} is recorded as filed, so this month’s purchases and credit are locked. A late bill goes in a later month.</p>}
      <p className="text-xs text-muted">
        {data.imported ? `GSTR-2B: ${data.imported.fileName}, ${data.imported.rowCount} rows, imported by ${data.imported.importedByName} on ${formatDateTime(data.imported.at)}. It is a read-only statement from the portal.` : `No GSTR-2B imported for ${formatMonth(data.period)} yet.`}
      </p>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile {...HEADLINE_TILE} label="Tax in your books" value={formatMoney(data.summary.booksTax)} />
        <StatTile {...HEADLINE_TILE} label="Tax in GSTR-2B" value={formatMoney(data.summary.portalTax)} />
        <StatTile {...HEADLINE_TILE} label="Credit decided" value={formatMoney(data.summary.claimed)} hint="Only what you approved" />
        <StatTile {...HEADLINE_TILE} label="Still to decide" value={data.summary.unresolved} tone={data.summary.unresolved > 0 ? 'text-orange' : 'text-ink'} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No purchases this month" message="Add your supplier bills and import GSTR-2B to compare them." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-muted">
              <tr>
                {['Supplier', 'Bill', 'Books tax', '2B tax', 'Match', 'ITC'].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PurchaseRow key={row.key} row={row} open={openRow === row.key} onToggle={() => setOpenRow(openRow === row.key ? null : row.key)} canChange={canChange} onAsk={setAsking} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Next: when everything is decided, open the month’s <Link to="/app/gst?tab=returns" className="underline">GSTR-3B working sheet</Link>. Please have your tax person check your credit decisions.
      </p>

      {asking === 'add' && <AddBillModal gstin={data.gstin} period={data.period} today={today} onClose={() => setAsking(null)} />}
      {asking === 'import' && <ImportModal gstin={data.gstin} period={data.period} onClose={() => setAsking(null)} />}
      {asking?.decide && <DecideModal row={asking.decide} onClose={() => setAsking(null)} />}
      {asking?.cancel && <CancelModal bill={asking.cancel} onClose={() => setAsking(null)} />}
      {asking?.notClaimed && <NotClaimedModal row={asking.notClaimed} gstin={data.gstin} period={data.period} onClose={() => setAsking(null)} />}
    </div>
  );
}

function itcWords(row) {
  if (row.status === 'DUPLICATE') return { label: 'Cancel it', tone: 'danger' };
  if (!row.decision) return { label: 'To decide', tone: 'yellow' };
  if (!row.resolved) return { label: 'Decide again', tone: 'orange' };
  return taxOf(row.decision.eligible) > 0 ? { label: `${formatMoney(taxOf(row.decision.eligible))} claimed`, tone: 'brown' } : { label: 'Not claimed', tone: 'neutral' };
}

// One row: on a click, the source bill, the portal's record, the suggestion and the decisions
function PurchaseRow({ row, open, onToggle, canChange, onAsk }) {
  const { bill, portal } = row;
  const itc = itcWords(row);
  return (
    <>
      <tr className="cursor-pointer border-t border-border align-top hover:bg-surface" onClick={onToggle}>
        <td className="px-4 py-3">
          <span className="flex items-start gap-1">
            {open ? <ChevronDown size={14} className="mt-1 shrink-0" /> : <ChevronRight size={14} className="mt-1 shrink-0" />}
            <span>
              {bill?.supplierName ?? portal?.supplierName ?? portal?.supplierGstin}
              <span className="block font-mono text-xs text-muted">{bill?.supplierGstin ?? portal?.supplierGstin}</span>
            </span>
          </span>
        </td>
        <td className="px-4 py-3 font-mono text-xs">{bill?.billNumber ?? portal?.billNumber}</td>
        <td className="px-4 py-3">{bill ? formatMoney(taxOf(bill)) : '—'}</td>
        <td className="px-4 py-3">{portal ? formatMoney(taxOf(portal)) : '—'}</td>
        <td className="px-4 py-3"><Badge tone={MATCH[row.status].tone}>{MATCH[row.status].label}</Badge></td>
        <td className="px-4 py-3"><Badge tone={itc.tone}>{itc.label}</Badge></td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-surface">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid gap-4 text-sm md:grid-cols-3">
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Your bill</p>
                {bill ? (
                  <dl className="flex flex-col gap-0.5">
                    <SummaryRow label="Date" value={formatDate(bill.billDate)} muted />
                    <SummaryRow label="Taxable" value={formatMoney(bill.taxable)} muted />
                    <SummaryRow label="GST" value={formatMoney(taxOf(bill))} muted />
                    <p className="mt-1 text-xs text-muted">{USE_WORDS[bill.use]}{bill.note ? ` · ${bill.note}` : ''}</p>
                  </dl>
                ) : <p className="text-muted">Not in your books.</p>}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted">GSTR-2B (read-only)</p>
                {portal ? (
                  <dl className="flex flex-col gap-0.5">
                    <SummaryRow label="Date" value={portal.billDate ? formatDate(portal.billDate) : '—'} muted />
                    <SummaryRow label="Taxable" value={formatMoney(portal.taxable)} muted />
                    <SummaryRow label="GST" value={formatMoney(taxOf(portal))} muted />
                    {portal.imsStatus && <p className="mt-1 text-xs text-muted">Portal status: {portal.imsStatus}</p>}
                  </dl>
                ) : <p className="text-muted">Not in GSTR-2B.</p>}
                {row.difference && Object.values(row.difference).some(Boolean) && (
                  <p className="mt-1 text-xs text-orange">Difference: taxable {formatMoney(row.difference.taxable)}, GST {formatMoney(row.difference.igst + row.difference.cgst + row.difference.sgst)}</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Credit</p>
                {row.note && <p className="text-xs text-orange">{row.note}</p>}
                {row.suggestion && <p className="text-xs text-muted">{row.suggestion.note}</p>}
                {row.history.map((d) => (
                  <p key={d._id} className={`mt-1 text-xs ${d._id === row.decision?._id ? '' : 'text-muted line-through'}`}>
                    {formatMoney(taxOf(d.eligible))} claimed, {formatMoney(taxOf(d.notEligible))} not. {d.reason} · {d.decidedByName}, {formatDateTime(d.createdAt)}
                  </p>
                ))}
                {canChange && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {bill && row.status !== 'DUPLICATE' && <Button size="sm" onClick={(e) => { e.stopPropagation(); onAsk({ decide: row }); }}>Decide credit</Button>}
                    {bill && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onAsk({ cancel: bill }); }}>Cancel bill</Button>}
                    {!bill && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onAsk({ notClaimed: row }); }}>Don’t claim this</Button>}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AddBillModal({ gstin, period, today, onClose }) {
  const { user } = useAuth();
  const add = useAddPurchase();
  const [key] = useState(newRequestKey);
  const usesInventory = hasAddon(user, 'inventory');
  const [values, setValues] = useState({ supplierId: '', receiptId: '', supplierName: '', supplierGstin: '', billNumber: '', billDate: today, taxable: '', igst: '', cgst: '', sgst: '', use: 'NO_ITC_SERVICES', note: '' });
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));
  const money = (text) => text.trim() === '' || isValidRupees(text);
  const fieldError = (field) => (add.error?.details?.field === field ? add.error.message : null);
  const valid = values.supplierName.trim().length >= 2 && values.supplierGstin.length === 15 && values.billNumber.trim() && values.billDate && isValidRupees(values.taxable) && ['igst', 'cgst', 'sgst'].every((h) => money(values[h]));
  const paise = (text) => (text.trim() ? toPaise(text) : 0);

  function submit() {
    add.mutate(
      { key, gstin, period, supplierId: values.supplierId || null, receiptId: values.receiptId || null, supplierName: values.supplierName.trim(), supplierGstin: values.supplierGstin, billNumber: values.billNumber.trim(), billDate: values.billDate, taxable: toPaise(values.taxable), igst: paise(values.igst), cgst: paise(values.cgst), sgst: paise(values.sgst), use: values.use, note: values.note.trim() || undefined },
      { onSuccess: () => { toast.success('Bill added'); onClose(); } }
    );
  }

  return (
    <Modal open onClose={onClose} title={`Add a supplier bill · ${formatMonth(period)}`} footer={<ModalFooter onClose={onClose} disabled={!valid} loading={add.isPending} onClick={submit}>Add bill</ModalFooter>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {usesInventory && <InventoryPickers values={values} onChange={(change) => setValues((v) => ({ ...v, ...change }))} />}
        <Input label="Supplier name" value={values.supplierName} onChange={set('supplierName')} />
        <Input label="Supplier GSTIN" maxLength={15} value={values.supplierGstin} error={fieldError('supplierGstin')} onChange={(e) => setValues((v) => ({ ...v, supplierGstin: e.target.value.toUpperCase().replace(/\s/g, '') }))} />
        <Input label="Bill number" value={values.billNumber} onChange={set('billNumber')} />
        <Input label="Bill date" type="date" value={values.billDate} error={fieldError('period')} onChange={set('billDate')} />
        <Input label="Taxable value (₹)" inputMode="decimal" value={values.taxable} onChange={set('taxable')} />
        <Input label="IGST (₹)" inputMode="decimal" value={values.igst} error={fieldError('igst')} hint="Only if the supplier is in another state" onChange={set('igst')} />
        <Input label="CGST (₹)" inputMode="decimal" value={values.cgst} onChange={set('cgst')} />
        <Input label="SGST (₹)" inputMode="decimal" value={values.sgst} onChange={set('sgst')} />
        <div className="sm:col-span-2">
          <Select label="How are the goods used?" options={USES} value={values.use} onChange={set('use')} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Note (optional)" value={values.note} onChange={set('note')} />
        </div>
        {add.isError && !add.error.details?.field && <p className="text-sm text-danger sm:col-span-2">{refusalText(add.error)}</p>}
      </div>
    </Modal>
  );
}

// With the Inventory add-on: fill the bill in from a supplier or a delivery. Bills work without either.
function InventoryPickers({ values, onChange }) {
  const suppliers = useSuppliers().data ?? [];
  const receiptData = useReceipts().data;
  const receiptsList = (Array.isArray(receiptData) ? receiptData : (receiptData?.receipts ?? [])).filter((r) => r.kind !== 'RETURN');

  function chooseSupplier(e) {
    const supplier = suppliers.find((s) => s._id === e.target.value);
    onChange({ supplierId: e.target.value, ...(supplier ? { supplierName: supplier.name, supplierGstin: supplier.gstin ?? '' } : {}) });
  }
  function chooseReceipt(e) {
    const receipt = receiptsList.find((r) => r._id === e.target.value);
    const supplier = suppliers.find((s) => s._id === receipt?.supplierId);
    onChange({
      receiptId: e.target.value,
      ...(receipt ? { supplierId: receipt.supplierId ?? '', supplierName: receipt.supplierName ?? values.supplierName, billNumber: receipt.invoiceNumber ?? values.billNumber, supplierGstin: supplier?.gstin ?? values.supplierGstin } : {}),
    });
  }

  return (
    <>
      {suppliers.length > 0 && <Select label="Supplier from Inventory (optional)" placeholder="Choose, or type below" options={suppliers.map((s) => ({ value: s._id, label: s.name }))} value={values.supplierId} onChange={chooseSupplier} />}
      {receiptsList.length > 0 && <Select label="Delivery it came with (optional)" placeholder="None" options={receiptsList.map((r) => ({ value: r._id, label: `${r.supplierName ?? 'Delivery'}${r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''} · ${formatDate(r.at)}` }))} value={values.receiptId} onChange={chooseReceipt} />}
    </>
  );
}

function ImportModal({ gstin, period, onClose }) {
  const importFile = useImport2b();
  const [key] = useState(newRequestKey);
  const [file, setFile] = useState(null);
  const template = URL.createObjectURL(new Blob([`﻿${CSV_LAYOUT}`], { type: 'text/csv' }));
  useEffect(() => () => URL.revokeObjectURL(template), [template]);

  function submit() {
    importFile.mutate(
      { key, gstin, period, file },
      {
        onSuccess: ({ alreadyImported, rowCount }) => {
          toast.success(alreadyImported ? `This file was already imported (${rowCount} rows). Nothing changed.` : `${rowCount} rows imported`);
          onClose();
        },
      }
    );
  }

  return (
    <Modal open onClose={onClose} title={`Import GSTR-2B · ${formatMonth(period)}`} footer={<ModalFooter onClose={onClose} disabled={!file} loading={importFile.isPending} onClick={submit}>Import</ModalFooter>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">Download GSTR-2B as JSON from the GST portal and choose it here. The same file twice isn’t counted again.</p>
        <Input label="GSTR-2B file" type="file" accept=".json,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className="text-xs text-muted">
          If the portal’s file can’t be read, enter the rows in a CSV instead: <a href={template} download="GSTR2B-layout.csv" className="inline-flex items-center gap-1 underline"><Download size={12} /> CSV layout</a>
        </p>
        {importFile.isError && <p className="text-danger">{refusalText(importFile.error)}</p>}
      </div>
    </Modal>
  );
}

function DecideModal({ row, onClose }) {
  const decide = useDecideItc();
  const [key] = useState(newRequestKey);
  const { bill, suggestion, status } = row;
  const canClaim = status === 'MATCHED' && bill.use !== 'NO_ITC_SERVICES';
  const start = (head) => (canClaim && suggestion.eligible ? String(suggestion.eligible[head] / 100) : '0');
  const [amounts, setAmounts] = useState({ igst: start('igst'), cgst: start('cgst'), sgst: start('sgst') });
  const [reason, setReason] = useState('');
  const paise = (head) => (isValidRupees(amounts[head]) ? toPaise(amounts[head]) : 0);
  const tooHigh = ['igst', 'cgst', 'sgst'].some((h) => paise(h) > bill[h]);
  const valid = ['igst', 'cgst', 'sgst'].every((h) => isValidRupees(amounts[h]) || amounts[h].trim() === '0') && !tooHigh && reason.trim().length >= 3;
  const claim = paise('igst') + paise('cgst') + paise('sgst');

  function submit() {
    decide.mutate(
      { key, _id: bill._id, eligible: { igst: paise('igst'), cgst: paise('cgst'), sgst: paise('sgst') }, reason: reason.trim() },
      { onSuccess: () => { toast.success('Decision saved'); onClose(); } }
    );
  }

  return (
    <Modal open onClose={onClose} title={`Credit on ${bill.billNumber}`} footer={<ModalFooter onClose={onClose} disabled={!valid} loading={decide.isPending} onClick={submit}>Save decision</ModalFooter>}>
      <div className="flex flex-col gap-4 text-sm">
        <Card>
          <p className="font-medium">{bill.supplierName} · GST {formatMoney(taxOf(bill))}</p>
          <p className="text-xs text-muted">{suggestion.note}</p>
          {!canClaim && <p className="mt-1 text-xs text-orange">{status !== 'MATCHED' ? 'This bill doesn’t match GSTR-2B, so no credit can be claimed now.' : 'No credit can be claimed on this bill.'}</p>}
        </Card>
        <div className="grid gap-3 sm:grid-cols-3">
          {[['igst', 'IGST'], ['cgst', 'CGST'], ['sgst', 'SGST']].map(([head, label]) => (
            <Input key={head} label={`${label} to claim (₹)`} inputMode="decimal" disabled={!canClaim || bill[head] === 0} value={amounts[head]} hint={`On the bill: ${formatMoney(bill[head])}`} error={paise(head) > bill[head] ? 'More than the bill' : null} onChange={(e) => setAmounts((a) => ({ ...a, [head]: e.target.value }))} />
          ))}
        </div>
        <p>Claim {formatMoney(claim)} · not claimed {formatMoney(taxOf(bill) - claim)}</p>
        <Textarea label="Reason" placeholder="e.g. Used only for 5% salon services" value={reason} onChange={(e) => setReason(e.target.value)} />
        {decide.isError && <p className="text-danger">{refusalText(decide.error)}</p>}
      </div>
    </Modal>
  );
}

function CancelModal({ bill, onClose }) {
  const cancel = useCancelPurchase();
  const [key] = useState(newRequestKey);
  return (
    <ReasonModal
      title={`Cancel bill ${bill.billNumber}`}
      message="It stays on record, marked cancelled, and any credit decided on it goes."
      confirmLabel="Cancel bill"
      loading={cancel.isPending}
      error={cancel.isError ? refusalText(cancel.error) : null}
      onClose={onClose}
      onConfirm={(reason) => cancel.mutate({ key, _id: bill._id, reason }, { onSuccess: () => { toast.success('Bill cancelled'); onClose(); } })}
    />
  );
}

function NotClaimedModal({ row, gstin, period, onClose }) {
  const decide = useDecideMissing();
  const [key] = useState(newRequestKey);
  return (
    <ReasonModal
      title={`Don’t claim ${row.portal.billNumber}`}
      message="To claim it instead, add the bill to your books. Then it can be matched."
      confirmLabel="Don’t claim this"
      danger={false}
      loading={decide.isPending}
      error={decide.isError ? refusalText(decide.error) : null}
      onClose={onClose}
      onConfirm={(reason) => decide.mutate({ key, gstin, period, rowKey: row.key, reason }, { onSuccess: () => { toast.success('Decision saved'); onClose(); } })}
    />
  );
}
