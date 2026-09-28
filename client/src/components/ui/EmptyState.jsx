import { Inbox } from 'lucide-react';

// Shown when a list has nothing in it. `action` is usually a Button ("Add customer").
export default function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <Icon size={32} className="text-muted" />
      <p className="font-medium text-ink">{title}</p>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
