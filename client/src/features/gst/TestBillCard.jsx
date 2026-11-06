import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { refusalText, useTestBill } from '../../api/gst';
import { GST_STATES, ITC_LABEL, percentLabel, ruleLabel, taxRows } from '../../lib/billing';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { Button, Card, Input, Select, SummaryRow } from '../../components/ui';

// Try sample bills and see the tax, worked out exactly like a real bill. No bill is saved.
export default function TestBillCard({ setup }) {
  const test = useTestBill();
  const branches = setup.branches.filter((b) => b.status !== 'archived');
  const ruleOptions = setup.groups.filter((g) => g.current).map((g) => ({ value: g.groupId, label: ruleLabel(g) }));
  const newLine = () => ({ groupId: '', price: '', qty: '1' });
  const [branchId, setBranchId] = useState(branches[0]?._id ?? '');
  const [place, setPlace] = useState('');
  const [date, setDate] = useState(setup.today);
  const [lines, setLines] = useState([newLine()]);
  const setLine = (index, change) => setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const qtyOk = (line) => /^[1-9]\d{0,2}$/.test(line.qty);
  const valid = branchId && date && lines.every((l) => l.groupId && isValidRupees(l.price) && qtyOk(l));
  const result = test.data;

  function tryIt() {
    test.mutate({ branchId, placeOfSupply: place, date, lines: lines.map((l) => ({ groupId: l.groupId, unitPrice: toPaise(l.price), qty: Number(l.qty) })) });
  }

  return (
    <Card title="Test bill">
      {ruleOptions.length === 0 ? (
        <p className="text-sm text-muted">Approve a tax rule first, then try a sample bill here.</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Branch" options={branches.map((b) => ({ value: b._id, label: b.name }))} value={branchId} onChange={(e) => setBranchId(e.target.value)} />
            <Select label="Place of supply" options={[{ value: '', label: 'This branch’s state' }, ...GST_STATES]} value={place} onChange={(e) => setPlace(e.target.value)} />
            <Input label="Bill date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {lines.map((line, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_5rem_auto]">
              <Select label="Tax rule" placeholder="Choose a rule" options={ruleOptions} value={line.groupId} onChange={(e) => setLine(i, { groupId: e.target.value })} />
              <Input label="Price (₹)" inputMode="decimal" placeholder="1050" value={line.price} onChange={(e) => setLine(i, { price: e.target.value })} />
              <Input label="Qty" inputMode="numeric" value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <Button variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((rows) => rows.filter((_, n) => n !== i))}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setLines((rows) => [...rows, newLine()])}>
              <Plus size={14} /> Add a line
            </Button>
            <Button size="sm" disabled={!valid} loading={test.isPending} onClick={tryIt}>
              Work out the tax
            </Button>
          </div>
          {test.isError && <p className="text-danger">{refusalText(test.error)}</p>}
          {result && <TestResult result={result} />}
        </div>
      )}
    </Card>
  );
}

function TestResult({ result }) {
  return (
    <div className="rounded-lg border border-border p-3">
      {result.blockers.length > 0 && (
        <ul className="mb-3 list-disc pl-4 text-danger">
          {result.blockers.map((b) => (
            <li key={`${b.code}:${b.message}`}>{b.message}</li>
          ))}
        </ul>
      )}
      <p className="mb-2 text-xs text-muted">
        {formatDate(result.date)} · GSTIN {result.gstin ?? 'none'} · Place of supply: {result.placeOfSupply.stateName ?? 'not known'}
        {result.interstate && ' · another state, so IGST'} · {result.pricesIncludeTax ? 'prices include GST' : 'GST added on top'}
      </p>
      <ul className="mb-2 divide-y divide-border">
        {result.lines.map((line, i) => (
          <li key={i} className="flex justify-between gap-2 py-1">
            <span>
              {line.name} <span className="text-xs text-muted">· {line.code ?? 'no code'} · {percentLabel(line.rateBps)} {ITC_LABEL[line.itcType] ?? ''}</span>
            </span>
            <span>{formatMoney(line.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <dl className="ml-auto flex max-w-xs flex-col gap-1">
        <SummaryRow label="Taxable value" value={formatMoney(result.totals.taxableTotal)} />
        {taxRows(result.taxSummary).map((t) => (
          <SummaryRow key={t.key} label={t.label} value={formatMoney(t.amount)} muted />
        ))}
        <div className="flex justify-between border-t border-border pt-1 font-bold text-brown">
          <dt>Total</dt>
          <dd>{formatMoney(result.totals.grandTotal)}</dd>
        </div>
      </dl>
    </div>
  );
}
