import { useState } from 'react';
import { Input, Modal, ModalFooter, Textarea } from './ui';

// Asks for a reason before something that needs one (void a bill, reverse a payment, send an order back).
// singleLine: a one-line box instead of a big one. onConfirm gets the reason, trimmed.
export default function ReasonModal({ title, message, label = 'Reason', placeholder, confirmLabel, danger = true, singleLine = false, loading, error, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const Box = singleLine ? Input : Textarea;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <ModalFooter onClose={onClose} variant={danger ? 'danger' : 'primary'} disabled={reason.trim().length < 3} loading={loading} onClick={() => onConfirm(reason.trim())}>
          {confirmLabel}
        </ModalFooter>
      }
    >
      {message && <p className="mb-3 text-sm text-muted">{message}</p>}
      <Box id="reason-box" label={label} autoFocus={singleLine} placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
