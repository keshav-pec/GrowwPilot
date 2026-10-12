import { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, FileDown, Trash2 } from 'lucide-react';
import { payslipUrl, useCancelPayment, useRemoveAdjustment } from '../../api/payroll';
import { formatAmount } from '../../lib/money';
import { formatMonth, formatPayDay, isDeductionLine, nextMonth, salaryMethodLabel } from '../../lib/payroll';
import { Badge, Button, Drawer, Modal, Textarea } from '../../components/ui';
import AdjustmentModal from './AdjustmentModal';
import RecordPaymentModal from './RecordPaymentModal';

// Cancel a payment entered by mistake. It stays on record, marked cancelled.
function CancelPaymentModal({ payment, onClose }) {
  const cancel = useCancelPayment();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel this ${formatAmount(payment.amount)} payment?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            disabled={reason.trim().length < 3}
            onClick={() =>
              cancel.mutate(
                { id: payment._id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('Payment cancelled');
                    onClose();
                  },
                }
              )
            }
          >
            Cancel payment
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">Use this only if the payment was recorded by mistake. It stays in the history, marked cancelled.</p>
        <Textarea label="Reason" rows={2} placeholder="e.g. Recorded twice" value={reason} onChange={(e) => setReason(e.target.value)} />
        {cancel.isError && <p className="text-danger">{cancel.error.message}</p>}
      </div>
    </Modal>
  );
}

// One person's pay for the month, line by line, with what to check and their bonuses / deductions
// Locked months also show what has been paid, with "Record payment".
export default function PayrollItemDrawer({ item, month, locked, adjustments, payments, today, onOpenPaySetup, onClose }) {
  const removeAdjustment = useRemoveAdjustment();
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const earnings = item.lines.filter((l) => !isDeductionLine(l));
  const deductions = item.lines.filter(isDeductionLine);
  const myPayments = payments.filter((p) => p.itemId === item._id);
  const paid = myPayments.filter((p) => p.status === 'recorded').reduce((sum, p) => sum + p.amount, 0);
  const owed = Math.max(Math.max(item.net, 0) - paid, 0);
  const mine = adjustments.filter((a) => a.staffId === item.staffId);

  function remove(adjustment) {
    removeAdjustment.mutate(adjustment._id, { onSuccess: () => toast.success('Removed'), onError: (err) => toast.error(err.message) });
  }

  const Line = ({ line, minus }) => (
    <li className="flex items-start justify-between gap-3 py-2">
      <div>
        <p className="text-ink">{line.label}</p>
        {line.detail && <p className="text-xs text-muted">{line.detail}</p>}
      </div>
      <span className={`whitespace-nowrap ${minus ? 'text-danger' : ''}`}>
        {minus && '− '}
        {formatAmount(line.amount)}
      </span>
    </li>
  );

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={`${item.staffName} · ${formatMonth(month)}`}
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={onOpenPaySetup}>
              Pay setup
            </Button>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              {locked ? 'Add correction' : 'Add bonus or deduction'}
            </Button>
            {locked && owed > 0 && <Button onClick={() => setPaying(true)}>Record payment</Button>}
          </>
        }
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className="text-sm text-muted">{item.payDescription}</p>
          <a href={payslipUrl(item._id)} className="flex shrink-0 items-center gap-1 text-sm text-gold-dark hover:underline">
            <FileDown size={14} /> {locked ? 'Payslip' : 'Payslip preview'}
          </a>
        </div>

        {!locked && item.issues.length > 0 && (
          <ul className="mb-4 space-y-2">
            {item.issues.map((issue) => (
              <li key={issue.code} className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${issue.blocking ? 'bg-orange/10' : 'bg-yellow-soft'}`}>
                <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${issue.blocking ? 'text-orange' : 'text-muted'}`} />
                <span>
                  {issue.message}
                  {issue.blocking && <span className="font-medium"> · must be sorted before locking</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Earnings</h3>
        <ul className="mb-4 divide-y divide-border text-sm">
          {earnings.length === 0 ? <li className="py-2 text-muted">Nothing earned this month.</li> : earnings.map((l, i) => <Line key={i} line={l} />)}
        </ul>

        {deductions.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Deductions</h3>
            <ul className="mb-4 divide-y divide-border text-sm">
              {deductions.map((l, i) => (
                <Line key={i} line={l} minus />
              ))}
            </ul>
          </>
        )}

        <div className="mb-4 rounded-lg bg-surface px-3 py-2 text-sm">
          <div className="flex justify-between text-muted">
            <span>Earnings</span>
            <span>{formatAmount(item.gross)}</span>
          </div>
          {item.deductions > 0 && (
            <div className="flex justify-between text-muted">
              <span>Deductions</span>
              <span>− {formatAmount(item.deductions)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-border pt-1 text-base font-semibold text-ink">
            <span>To pay</span>
            <span>{formatAmount(item.net)}</span>
          </div>
        </div>

        {locked && (
          <section className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Payments</h3>
              {owed === 0 ? <Badge tone="brown">Paid in full</Badge> : <Badge tone={paid ? 'gold' : 'orange'}>{formatAmount(owed)} still owed</Badge>}
            </div>
            {myPayments.length === 0 ? (
              <p className="text-sm text-muted">Nothing paid yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {myPayments.map((p) => (
                  <li key={p._id} className={`flex items-start justify-between gap-2 py-2 ${p.status === 'cancelled' ? 'text-muted line-through' : ''}`}>
                    <span>
                      {formatPayDay(p.paidOn)} · {salaryMethodLabel(p.method)}
                      {p.reference && ` · ${p.reference}`}
                      <span className="block text-xs text-muted no-underline">
                        Recorded by {p.recordedByName}
                        {p.overpaid && ' · more than owed'}
                        {p.note && ` · “${p.note}”`}
                        {p.status === 'cancelled' && ` · cancelled by ${p.cancelledByName}: ${p.cancelReason}`}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      {formatAmount(p.amount)}
                      {p.status === 'recorded' && (
                        <button type="button" onClick={() => setCancelling(p)} className="rounded p-1 text-muted hover:bg-surface" aria-label="Cancel payment">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {item.notes.map((note) => (
          <p key={note} className="mb-2 text-sm text-muted">
            {note}
          </p>
        ))}

        {!locked && mine.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Bonuses and deductions added</h3>
            <ul className="divide-y divide-border text-sm">
              {mine.map((a) => (
                <li key={a._id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {a.kind === 'bonus' ? 'Bonus' : 'Deduction'} {formatAmount(a.amount)} · {a.reason}
                    <span className="block text-xs text-muted">Added by {a.createdByName}</span>
                  </span>
                  <button type="button" onClick={() => remove(a)} className="rounded p-1 text-muted hover:bg-surface" aria-label="Remove">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Drawer>

      {paying && <RecordPaymentModal item={item} owed={owed} today={today} onClose={() => setPaying(false)} />}
      {cancelling && <CancelPaymentModal payment={cancelling} onClose={() => setCancelling(null)} />}
      {adding && (
        <AdjustmentModal
          staff={{ _id: item.staffId, name: item.staffName }}
          month={locked ? nextMonth(month) : month}
          correctsMonth={locked ? month : undefined}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
