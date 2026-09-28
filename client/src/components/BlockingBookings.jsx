import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../lib/time';

// The upcoming bookings the server sent back with a HAS_FUTURE_BOOKINGS error
export default function BlockingBookings({ bookings }) {
  const { user } = useAuth();
  const timezoneOf = (branchId) => user.branches.find((b) => b._id === branchId)?.timezone;

  return (
    <ul className="mt-3 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
      {bookings.map((booking) => (
        <li key={booking._id} className="px-3 py-2 text-sm">
          <p className="font-medium text-ink">{booking.customerName}</p>
          <p className="text-xs text-muted">
            {formatDateTime(booking.startAt, timezoneOf(booking.branchId))} · {booking.staffNames.join(', ')}
          </p>
        </li>
      ))}
    </ul>
  );
}
