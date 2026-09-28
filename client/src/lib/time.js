import { DateTime } from 'luxon';

// The server sends times in UTC. We always show them in the branch's timezone.

// "28 Sep 2026, 2:30 PM"
export function formatDateTime(iso, zone) {
  return DateTime.fromISO(iso, { zone }).toFormat('d LLL yyyy, h:mm a');
}

// "2:30 PM"
export function formatTime(iso, zone) {
  return DateTime.fromISO(iso, { zone }).toFormat('h:mm a');
}

// "28 Sep 2026"
export function formatDate(iso, zone) {
  return DateTime.fromISO(iso, { zone }).toFormat('d LLL yyyy');
}
