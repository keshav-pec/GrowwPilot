import { useState } from 'react';
import toast from 'react-hot-toast';
import { useEmailBill } from '../../api/invoices';
import { newRequestKey } from '../../lib/requestKey';
import { Input, Modal, ModalFooter } from '../../components/ui';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email bill: to the customer's email on file (shown partly hidden), or another address typed in.
// The bill goes as a PDF attachment, from the salon's name; the app sends it in the background.
export default function EmailBillModal({ invoice, customerEmail, onClose }) {
  const send = useEmailBill();
  const [key] = useState(newRequestKey);
  const [other, setOther] = useState(!customerEmail);
  const [to, setTo] = useState('');
  const error = other && to.trim() && !EMAIL.test(to.trim()) ? 'Enter a valid email' : null;

  function submit() {
    send.mutate(
      { id: invoice._id, key, to: other ? to.trim() : undefined },
      {
        onSuccess: (result) => {
          toast.success(`Bill is on its way to ${result.to}`);
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
      title={`Email bill ${invoice.invoiceNumber}`}
      footer={
        <ModalFooter onClose={onClose} onClick={submit} loading={send.isPending} disabled={other && (!to.trim() || Boolean(error))}>
            Email bill
          </ModalFooter>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {customerEmail && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-gold" checked={!other} onChange={() => setOther(false)} />
              The customer’s email: <strong>{customerEmail}</strong>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-gold" checked={other} onChange={() => setOther(true)} />
              Another email
            </label>
          </div>
        )}
        {other && <Input id="bill-email-to" label="Email" type="email" autoFocus value={to} onChange={(e) => setTo(e.target.value)} error={error} hint={customerEmail ? null : 'This customer has no email on file.'} />}
        <p className="text-xs text-muted">The bill is attached as a PDF (the phone number partly hidden). Replies go to your salon’s contact email.</p>
      </div>
    </Modal>
  );
}
