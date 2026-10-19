import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateRefund, useRefundQuote } from '../../api/refunds';
import { formatMoney } from '../../lib/money';
import { PAYMENT_METHODS, newRequestKey } from '../../lib/billing';
import { Button, Input, Modal, Select, Spinner, Textarea } from '../../components/ui';

const RESTOCK = [
  { value: 'SELLABLE', label: 'Can be sold again' },
  { value: 'DAMAGED', label: 'Damaged' },
];

// Refund or return: pick lines and how many, say why. The server works out the money (with GST):
// what goes back to the customer, and what just comes off what they still owe.
// An owner who may approve refunds does it straight away; the front desk sends a request.
export default function RefundModal({ invoice, mayApprove, onClose }) {
  const refundable = invoice.lines.filter((l) => l.qty - (l.refundedQty ?? 0) > 0);
  const [picked, setPicked] = useState({}); // lineId -> { qty, restock }
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState(invoice.payments.find((p) => p.kind === 'PAYMENT' && p.status === 'VALID')?.method ?? 'CASH');
  const [reference, setReference] = useState('');
  const [key] = useState(newRequestKey);
  const create = useCreateRefund();

  const lines = useMemo(() => Object.entries(picked).map(([lineId, p]) => ({ lineId, qty: p.qty, ...(p.restock ? { restock: p.restock } : {}) })), [picked]);
  const quote = useRefundQuote(invoice._id, lines, lines.length > 0);
  const plan = quote.data;

  function toggle(line) {
    setPicked((current) => {
      const next = { ...current };
      if (next[line._id]) delete next[line._id];
      else next[line._id] = { qty: line.qty - (line.refundedQty ?? 0), restock: line.kind === 'PRODUCT' ? 'SELLABLE' : null };
      return next;
    });
  }
  const change = (lineId, field, value) => setPicked((current) => ({ ...current, [lineId]: { ...current[lineId], [field]: value } }));

  function submit() {
    create.mutate(
      { key, invoiceId: invoice._id, lines, reason: reason.trim(), method, reference: reference.trim() || undefined },
      {
        onSuccess: ({ refund }) => {
          toast.success(refund.status === 'DONE' ? `Refunded ${formatMoney(refund.creditTotal)}` : 'Sent to an owner for approval');
          onClose();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund or return · ${invoice.invoiceNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!plan || quote.isFetching || reason.trim().length < 3} loading={create.isPending}>
            {mayApprove ? `Refund ${plan ? formatMoney(plan.creditTotal) : ''}` : 'Ask an owner to approve'}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-border text-sm">
        {refundable.map((line) => {
          const left = line.qty - (line.refundedQty ?? 0);
          const p = picked[line._id];
          return (
            <li key={line._id} className="flex flex-col gap-2 py-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-gold" checked={Boolean(p)} onChange={() => toggle(line)} />
                <span className="font-medium">{line.name}</span>
                <span className="text-muted">
                  · {left} of {line.qty} · {formatMoney(line.lineTotal)}
                </span>
              </label>
              {p && line.kind === 'PRODUCT' && (
                <div className="ml-6 grid grid-cols-2 gap-2">
                  <Select aria-label="How many" options={Array.from({ length: left }, (_, i) => ({ value: String(i + 1), label: `${i + 1} returned` }))} value={String(p.qty)} onChange={(e) => change(line._id, 'qty', Number(e.target.value))} />
                  <Select aria-label="Condition" options={RESTOCK} value={p.restock} onChange={(e) => change(line._id, 'restock', e.target.value)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {refundable.length === 0 && <p className="text-sm text-muted">Everything on this bill has already been refunded.</p>}

      {lines.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface p-3 text-sm">
          {quote.isFetching && !plan ? (
            <Spinner size={16} />
          ) : quote.isError ? (
            <p className="text-danger">{quote.error.message}</p>
          ) : (
            plan && (
              <>
                <p className="flex justify-between font-medium">
                  <span>Refund value{invoice.gstRegistered ? ' (incl. GST)' : ''}</span>
                  <span>{formatMoney(plan.creditTotal)}</span>
                </p>
                {plan.cashRefund > 0 && (
                  <p className="flex justify-between">
                    <span>Give back to the customer</span>
                    <span>{formatMoney(plan.cashRefund)}</span>
                  </p>
                )}
                {plan.dueReduced > 0 && (
                  <p className="flex justify-between text-muted">
                    <span>Comes off what they still owe</span>
                    <span>{formatMoney(plan.dueReduced)}</span>
                  </p>
                )}
              </>
            )
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {plan?.cashRefund > 0 && (
          <>
            <Select label="Give the money back by" options={PAYMENT_METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
            <Input label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
          </>
        )}
        <div className="sm:col-span-2">
          <Textarea label="Reason" placeholder="e.g. Wrong shade, customer unhappy with the service" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Refunded services don’t return the products used. Their commission is taken back.</p>
    </Modal>
  );
}
