import Modal from './Modal';
import ModalFooter from './ModalFooter';

// "Are you sure?" popup for actions like deactivate or cancel.
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <ModalFooter onClose={onClose} variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </ModalFooter>
      }
    >
      <div className="text-sm text-muted">{message}</div>
    </Modal>
  );
}
