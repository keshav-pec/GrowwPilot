import { useState } from 'react';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { useAdvances, useCloseAdvance, useGiveAdvance } from '../../api/payroll';
import { formatAmount, isValidRupees, toPaise } from '../../lib/money';
import { SALARY_METHODS, formatMonth, formatPayDay, nextMonth } from '../../lib/payroll';
import { Badge, Button, Input, Modal, Select, Textarea } from '../../components/ui';

// Give money now, take it back from pay each month
function GiveAdvanceModal({ staff, today, onClose }) {
  const give = useGiveAdvance();
  const [key] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState({ amount: '', monthly: '', method: 'CASH', reference: '', givenOn: today, firstMonth: nextMonth(today.slice(0, 7)), reason: '' });
  const [error, setError] = useState(null);
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  const valid = isValidRupees(values.amount) && isValidRupees(values.monthly) && Number(values.monthly) > 0;
  const months = valid ? Math.ceil(Number(values.amount) / Number(values.monthly)) : 0;
  const lastMonth = months ? DateTime.fromISO(`${values.firstMonth}-01`).plus({ months: months - 1 }).toFormat('yyyy-MM') : null;

  function save() {
    if (!valid || Number(values.amount) <= 0) return setError('Enter the advance and the monthly repayment');
    if (Number(values.monthly) > Number(values.amount)) return setError('The monthly repayment can’t be more than the advance');
    if (values.reason.trim().length < 3) return setError('Please give a reason');
    give.mutate(
      {
        staffId: staff._id,
        key,
        amount: toPaise(values.amount),
        monthlyRepayment: toPaise(values.monthly),
        method: values.method,
        reference: values.reference.trim() || undefined,
        givenOn: values.givenOn,
        firstMonth: values.firstMonth,
        reason: values.reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success('Advance recorded');
          onClose();
        },
        onError: (err) => setError(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Give ${staff.name} an advance`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={give.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Advance (₹)" inputMode="decimal" value={values.amount} onChange={set('amount')} />
        <Input label="Take back each month (₹)" inputMode="decimal" value={values.monthly} onChange={set('monthly')} />
        <Select label="Given by" options={SALARY_METHODS} value={values.method} onChange={set('method')} />
        <Input label="Date given" type="date" max={today} value={values.givenOn} onChange={set('givenOn')} />
        <Input label="First month to take back" type="month" value={values.firstMonth} onChange={set('firstMonth')} />
        <Input label="Reference (optional)" value={values.reference} onChange={set('reference')} />
        <div className="sm:col-span-2">
          <Textarea label="Reason" rows={2} placeholder="e.g. Family wedding" value={values.reason} onChange={set('reason')} />
        </div>
        {months > 0 && (
          <p className="rounded-lg bg-surface px-3 py-2 text-sm sm:col-span-2">
            Taken off pay over {months} {months === 1 ? 'month' : 'months'}: {formatMonth(values.firstMonth)}
            {months > 1 && ` to ${formatMonth(lastMonth)}`}. It shows as a deduction in each month’s payroll.
          </p>
        )}
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}

// Stop taking repayments, e.g. the rest was paid back in cash
function CloseAdvanceModal({ advance, today, onClose }) {
  const close = useCloseAdvance();
  const [fromMonth, setFromMonth] = useState(today.slice(0, 7));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  function save() {
    if (reason.trim().length < 3) return setError('Please give a reason');
    close.mutate(
      { id: advance._id, fromMonth, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success('Repayments stopped');
          onClose();
        },
        onError: (err) => setError(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Stop repayments?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={save} loading={close.isPending}>
            Stop repayments
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">Nothing more is taken off pay from the month you choose. Months already locked keep their repayment.</p>
        <Input label="Stop from" type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        <Textarea label="Reason" rows={2} placeholder="e.g. Paid back the rest in cash" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

// Owners: money given in advance, and how much is still to be taken back
export default function AdvancesSection({ staff, today }) {
  const advancesQuery = useAdvances(staff._id);
  const [giving, setGiving] = useState(false);
  const [closing, setClosing] = useState(null);
  const advances = advancesQuery.data ?? [];

  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Advances</h3>
      {advances.length > 0 && (
        <ul className="mb-2 space-y-2 text-sm">
          {advances.map((a) => (
            <li key={a._id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{formatAmount(a.amount)}</span>
                {a.closedFromMonth ? <Badge>Stopped</Badge> : a.balance <= 0 ? <Badge tone="brown">Repaid</Badge> : <Badge tone="gold">{formatAmount(a.balance)} to go</Badge>}
              </div>
              <p className="text-muted">
                Given {formatPayDay(a.givenOn)} · {a.reason}
              </p>
              <p className="text-xs text-muted">
                {formatAmount(a.monthlyRepayment)}/month, {formatMonth(a.firstMonth)}
                {a.repaymentCount > 1 && ` – ${formatMonth(a.lastMonth)}`} · {formatAmount(a.repaid)} taken back in locked months
                {a.closedFromMonth && ` · stopped from ${formatMonth(a.closedFromMonth)} (${a.closeReason})`}
              </p>
              {!a.closedFromMonth && a.balance > 0 && (
                <button type="button" onClick={() => setClosing(a)} className="mt-1 text-xs text-gold-dark hover:underline">
                  Stop repayments
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="secondary" onClick={() => setGiving(true)}>
        Give an advance
      </Button>
      {giving && <GiveAdvanceModal staff={staff} today={today} onClose={() => setGiving(false)} />}
      {closing && <CloseAdvanceModal advance={closing} today={today} onClose={() => setClosing(null)} />}
    </section>
  );
}
