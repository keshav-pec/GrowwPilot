import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRecordPayment } from '../../api/invoices';
import { formatMoney } from '../../lib/money';
import { newRequestKey } from '../../lib/billing';
import { Button, Modal } from '../../components/ui';
import PaymentRows, { emptyPayment, paidTotal, paymentsPayload, rowsInvalid } from './PaymentRows';

// Take money for what's still due on an issued bill (all of it, or part of it again)
export default function RecordPaymentModal({ invoice, onClose }) {
  const [rows, setRows] = useState([{ ...emptyPayment(), amount: String(invoice.balanceDue / 100) }]);
  const [key] = useState(newRequestKey);
  const record = useRecordPayment();
  const paying = paidTotal(rows);
  const left = invoice.balanceDue - paying;
  const valid = paying > 0 && left >= 0 && !rowsInvalid(rows);

  function save() {
    record.mutate(
      { key, invoiceId: invoice._id, payments: paymentsPayload(rows) },
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
            Record {formatMoney(paying)}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        <span className="font-medium">{formatMoney(invoice.balanceDue)}</span> is due from {invoice.customerSnapshot?.name}.
      </p>
      <PaymentRows rows={rows} onChange={setRows} total={invoice.balanceDue} />
      <p className={`mt-3 text-sm font-medium ${left < 0 ? 'text-danger' : left > 0 ? 'text-orange' : 'text-brown'}`}>
        {left < 0 ? `Too much by ${formatMoney(-left)}` : left > 0 ? `${formatMoney(left)} will still be due` : 'This pays the bill in full'}
      </p>
    </Modal>
  );
}
