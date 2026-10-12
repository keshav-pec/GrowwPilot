import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useRecordPayment } from '../../api/payroll';
import { formatAmount, isValidRupees, toPaise } from '../../lib/money';
import { SALARY_METHODS, formatMonth } from '../../lib/payroll';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';

// Record money handed over for one person's locked month: all of it, or part
export default function RecordPaymentModal({ item, owed, today, onClose }) {
  const { user } = useAuth();
  const record = useRecordPayment();
  const [key] = useState(() => crypto.randomUUID()); // one key per form: a retry is recorded once
  const [amount, setAmount] = useState(owed > 0 ? String(owed / 100) : '');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [allowOverpay, setAllowOverpay] = useState(false);
  const [error, setError] = useState(null);

  const tooMuch = isValidRupees(amount) && toPaise(amount) > owed;

  function save() {
    if (!isValidRupees(amount) || Number(amount) <= 0) return setError('Enter an amount like 18000 or 499.50');
    if (tooMuch && !allowOverpay) return setError(`Only ${formatAmount(owed)} is still owed.`);
    if (allowOverpay && note.trim().length < 3) return setError('Please say why you’re paying more than is owed');
    record.mutate(
      {
        itemId: item._id,
        key,
        amount: toPaise(amount),
        method,
        reference: reference.trim() || undefined,
        paidOn,
        note: note.trim() || undefined,
        allowOverpay: tooMuch && allowOverpay ? true : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Payment to ${item.staffName} recorded`);
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
      title={`Pay ${item.staffName} for ${formatMonth(item.month)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={record.isPending}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm text-muted sm:col-span-2">
          Still owed: <span className="font-semibold text-ink">{formatAmount(owed)}</span> of {formatAmount(Math.max(item.net, 0))}. You can pay part now and the rest later.
        </p>
        <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Select label="Paid by" options={SALARY_METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        <Input label="Date paid" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        <Input
          label={method === 'CASH' ? 'Reference (optional)' : 'Transaction ID'}
          placeholder={method === 'UPI' ? 'e.g. 4321 8765 1234' : ''}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        {tooMuch &&
          (user.allBranches ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={allowOverpay} onChange={(e) => setAllowOverpay(e.target.checked)} className="accent-gold" />
              Pay more than is owed (please say why below)
            </label>
          ) : (
            <p className="text-sm text-danger sm:col-span-2">That’s more than is owed. Only the business owner can pay extra.</p>
          ))}
        <div className="sm:col-span-2">
          <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
