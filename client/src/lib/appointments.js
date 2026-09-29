import { DateTime } from 'luxon';

export const STATUS_LABEL = {
  BOOKED: 'Booked',
  ARRIVED: 'Arrived',
  IN_SERVICE: 'In service',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// The one-click "next step" button for each status (the server checks the rules again)
export const NEXT_STEP = {
  BOOKED: { status: 'ARRIVED', label: 'Mark arrived' },
  ARRIVED: { status: 'IN_SERVICE', label: 'Start' },
  IN_SERVICE: { status: 'COMPLETED', label: 'Complete' },
};

// Warnings from plan section 4.3. Returns a short label, or null if all is fine.
export function getAlert(appointment, now = DateTime.now()) {
  const start = DateTime.fromISO(appointment.startAt);
  const end = DateTime.fromISO(appointment.endAt);
  const minutesSinceStart = now.diff(start, 'minutes').minutes;

  if (appointment.status === 'BOOKED' && minutesSinceStart >= 15) return 'Possible no-show';
  if (appointment.status === 'ARRIVED' && minutesSinceStart >= 10) return 'Waiting';
  if (['BOOKED', 'ARRIVED', 'IN_SERVICE'].includes(appointment.status) && now > end) return 'Running late';
  return null;
}

// Names of all stylists in an appointment, e.g. "Rahul, Neha"
export function staffNames(appointment) {
  return [...new Set(appointment.items.map((item) => item.staffName))].join(', ');
}
