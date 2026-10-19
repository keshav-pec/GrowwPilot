import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRecordPayment } from '../../api/invoices';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { newRequestKey } from '../../lib/billing';
import { Button, Input, Modal } from '../../components/ui';
import PaymentRows, { emptyPayment, paidTotal, paymentsPayload, rowsInvalid } from './PaymentRows';

// Take money for what's still due on an issued bill (all of it, or part of it again), or use the customer's advance
export default function RecordPaymentModal({ invoice, onClose }) {
  const advanceBalance = invoice.advanceBalance ?? 0;
  const [rows, setRows] = useState([{ ...emptyPayment(), amount: advanceBalance > 0 ? '' : String(invoice.balanceDue / 100) }]);
  const [advanceText, setAdvanceText] = useState(advanceBalance > 0 ? String(Math.min(advanceBalance, invoice.balanceDue) / 100) : '');
  const [key] = useState(newRequestKey);
  const record = useRecordPayment();
  const advanceUse = isValidRupees(advanceText) ? toPaise(advanceText) : 0;
  const advanceError = advanceText.trim() && !isValidRupees(advanceText) ? 'Enter an amount' : advanceUse > advanceBalance ? `Only ${formatMoney(advanceBalance)} left` : null;
  const paying = paidTotal(rows);
  const left = invoice.balanceDue - advanceUse - paying;
  const valid = paying + advanceUse > 0 && left >= 0 && !rowsInvalid(rows) && !advanceError;

  function save() {
    record.mutate(
      { key, invoiceId: invoice._id, payments: paymentsPayload(rows), useAdvance: advanceUse },
      {
        onSuccess: (saved) => {
          toast.success(saved.balanceDue === 0 ? 'Bill fully paid' : `Payment recorded · ${formatMoney(saved.balanceDue)} still due`);
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
      title={`Record payment · ${invoice.invoiceNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid} loading={record.isPending}>
            Record {formatMoney(paying + advanceUse)}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        <span className="font-medium">{formatMoney(invoice.balanceDue)}</span> is due from {invoice.customerSnapshot?.name}.
      </p>
      {advanceBalance > 0 && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-lg bg-surface p-3 text-sm">
          <p className="font-medium">Advance available: {formatMoney(advanceBalance)}</p>
          <div className="w-32">
            <Input inputMode="decimal" placeholder="Use ₹" value={advanceText} onChange={(e) => setAdvanceText(e.target.value)} error={advanceError} aria-label="Advance to use" />
          </div>
        </div>
      )}
      <PaymentRows rows={rows} onChange={setRows} total={Math.max(invoice.balanceDue - advanceUse, 0)} />
      <p className={`mt-3 text-sm font-medium ${left < 0 ? 'text-danger' : left > 0 ? 'text-orange' : 'text-brown'}`}>
        {left < 0 ? `Too much by ${formatMoney(-left)}` : left > 0 ? `${formatMoney(left)} will still be due` : 'This pays the bill in full'}
      </p>
    </Modal>
  );
}
