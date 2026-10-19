import { useState } from 'react';
import { Button, Modal, Textarea } from '../../components/ui';

// Asks for a reason before something that needs one (void a bill, reverse a payment, turn down a refund)
export default function ReasonModal({ title, message, label = 'Reason', confirmLabel, danger = true, loading, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={reason.trim().length < 3} loading={loading} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="mb-3 text-sm text-muted">{message}</p>}
      <Textarea label={label} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
