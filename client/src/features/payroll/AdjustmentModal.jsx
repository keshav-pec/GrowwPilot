import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAddAdjustment } from '../../api/payroll';
import { isValidRupees, toPaise } from '../../lib/money';
import { formatMonth } from '../../lib/payroll';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';

// Add a bonus or a deduction to one person's pay for a month, always with a reason.
// correctsMonth: set when this fixes a month that is already locked.
export default function AdjustmentModal({ staff, month, correctsMonth, onClose }) {
  const add = useAddAdjustment();
  const [kind, setKind] = useState('bonus');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  function save() {
    if (!isValidRupees(amount) || Number(amount) <= 0) return setError('Enter an amount like 1000 or 499.50');
    if (reason.trim().length < 3) return setError('Please give a reason');
    add.mutate(
      { staffId: staff._id, month, kind, amount: toPaise(amount), reason: reason.trim(), correctsMonth },
      {
        onSuccess: () => {
          toast.success(kind === 'bonus' ? 'Bonus added' : 'Deduction added');
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
      title={correctsMonth ? `Correction for ${staff.name}` : `Bonus or deduction for ${staff.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={add.isPending}>
            Add
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {correctsMonth && (
          <p className="rounded-lg bg-yellow-soft px-3 py-2 text-sm sm:col-span-2">
            {formatMonth(correctsMonth)} is locked, so this goes into <b>{formatMonth(month)}</b>, marked as a correction for {formatMonth(correctsMonth)}.
          </p>
        )}
        <Select
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          options={[
            { value: 'bonus', label: 'Bonus (adds to pay)' },
            { value: 'deduction', label: 'Deduction (takes off pay)' },
          ]}
        />
        <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="sm:col-span-2">
          <Textarea
            label="Reason"
            rows={2}
            placeholder={kind === 'bonus' ? 'e.g. Diwali bonus' : 'e.g. 2 days unpaid leave, or salary advance'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted sm:col-span-2">Shown on the payslip and saved in the activity log.</p>
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
