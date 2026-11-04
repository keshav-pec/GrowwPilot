import { X } from 'lucide-react';
import { useEscapeKey } from './useEscapeKey';

const widths = { md: 'max-w-md', wide: 'max-w-2xl' };

// A panel that slides in from the right (used for details like a lead's timeline). On a phone it fills the screen.
// size: 'md' (default) or 'wide'
export default function Drawer({ open, onClose, title, footer, size = 'md', children }) {
  useEscapeKey(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className={`flex h-full w-full ${widths[size]} flex-col bg-bg shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold text-brown">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
