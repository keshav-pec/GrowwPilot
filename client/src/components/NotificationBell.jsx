import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import { Bell } from 'lucide-react';
import { useMarkNotificationsRead, useNotifications } from '../api/notifications';

// The bell in the top bar: pay change requests, approvals, and (for the business owner) every pay change
export default function NotificationBell() {
  const navigate = useNavigate();
  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // Close when clicking anywhere outside the panel
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => !panelRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const { items = [], unread = 0 } = notificationsQuery.data ?? {};

  function openItem(item) {
    if (!item.readAt) markRead.mutate([item._id]);
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-1.5 text-ink hover:bg-surface"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-bg shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm font-semibold text-brown">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate()} className="text-xs text-muted hover:text-ink">
                Mark all as read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing new.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {items.map((item) => (
                <li key={item._id}>
                  <button type="button" onClick={() => openItem(item)} className="flex w-full gap-2 px-4 py-3 text-left text-sm hover:bg-surface">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-gold'}`} />
                    <span>
                      <span className={item.readAt ? 'text-muted' : 'text-ink'}>{item.message}</span>
                      <span className="mt-0.5 block text-xs text-muted">{DateTime.fromISO(item.createdAt).toRelative()}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
