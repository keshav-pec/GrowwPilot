import { useEffect } from 'react';

// Calls onClose when Escape is pressed while `open` is true (popups and side panels)
export function useEscapeKey(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}
