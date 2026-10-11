import { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useRemoveAdjustment } from '../../api/payroll';
import { formatAmount } from '../../lib/money';
import { formatMonth, nextMonth } from '../../lib/payroll';
import { Button, Drawer } from '../../components/ui';
import AdjustmentModal from './AdjustmentModal';

const DEDUCTION = 'deduction';

// One person's pay for the month, line by line, with what to check and their bonuses / deductions
export default function PayrollItemDrawer({ item, month, locked, adjustments, onOpenPaySetup, onClose }) {
  const removeAdjustment = useRemoveAdjustment();
  const [adding, setAdding] = useState(false);
  const earnings = item.lines.filter((l) => l.kind !== DEDUCTION);
  const deductions = item.lines.filter((l) => l.kind === DEDUCTION);
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
              {locked ? `Add a correction to ${formatMonth(nextMonth(month))}` : 'Add bonus or deduction'}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted">{item.payDescription}</p>

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
