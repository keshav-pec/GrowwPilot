import Button from './Button';

// The bottom of a popup: Cancel, then the main button (any Button props go to the main button)
export default function ModalFooter({ onClose, children, ...action }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button {...action}>{children}</Button>
    </>
  );
}
