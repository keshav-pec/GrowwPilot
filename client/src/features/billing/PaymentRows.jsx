import { Plus, Trash2 } from 'lucide-react';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { PAYMENT_METHODS } from '../../lib/billing';
import { Button, Input, Select } from '../../components/ui';

// Rupees typed in a box -> paise (empty or invalid counts as 0)
export const paiseOf = (text) => (isValidRupees(text) ? toPaise(text) : 0);
export const emptyPayment = (method = 'CASH') => ({ method, amount: '', reference: '' });

// What was typed -> what the server needs (rows left empty are skipped)
export function paymentsPayload(rows) {
  return rows.filter((r) => paiseOf(r.amount) > 0).map((r) => ({ method: r.method, amount: paiseOf(r.amount), reference: r.reference.trim() || undefined }));
}
export const paidTotal = (rows) => rows.reduce((sum, r) => sum + paiseOf(r.amount), 0);
// A box with something in it that isn't an amount
export const rowsInvalid = (rows) => rows.some((r) => r.amount.trim() !== '' && !isValidRupees(r.amount));

// Split payment: up to 5 rows of method + amount + reference. "Rest" fills in whatever is still unpaid.
// rows: [{ method, amount (text), reference }] · total: what can be paid (paise)
export default function PaymentRows({ rows, onChange, total }) {
  function update(index, field, value) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }
  function fillRest(index) {
    const others = rows.reduce((sum, r, i) => (i === index ? sum : sum + paiseOf(r.amount)), 0);
    update(index, 'amount', String(Math.max(total - others, 0) / 100));
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[7rem_1fr_1fr_auto]">
          <Select options={PAYMENT_METHODS} value={row.method} onChange={(e) => update(index, 'method', e.target.value)} aria-label="Method" />
          <div className="relative">
            <Input
              inputMode="decimal"
              placeholder="Amount ₹"
              value={row.amount}
              onChange={(e) => update(index, 'amount', e.target.value)}
              error={row.amount.trim() && !isValidRupees(row.amount) ? 'Enter an amount like 500' : null}
              aria-label="Amount"
            />
            <button type="button" onClick={() => fillRest(index)} className="absolute right-2 top-2 rounded bg-surface px-1.5 text-xs text-muted hover:text-ink">
              Rest
            </button>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Input placeholder={row.method === 'OTHER' ? 'What was it? (e.g. voucher)' : 'Reference (optional)'} value={row.reference} onChange={(e) => update(index, 'reference', e.target.value)} aria-label="Reference" />
          </div>
          <Button variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))} disabled={rows.length === 1} aria-label="Remove payment">
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      {rows.length < 5 && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => onChange([...rows, emptyPayment('UPI')])}>
          <Plus size={14} /> Add payment method
        </Button>
      )}
      <p className="text-xs text-muted">Never type card numbers here. For cards, the last 4 digits are enough. Up to {formatMoney(total)} can be paid.</p>
    </div>
  );
}
