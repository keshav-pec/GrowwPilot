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

// Today's date at a branch, e.g. "2026-09-28" (it can differ from your computer's date)
export function todayIn(zone) {
  return DateTime.now().setZone(zone).toISODate();
}

// "2026-09-28" -> "Mon, 28 Sep"
export function formatDay(date) {
  return DateTime.fromISO(date).toFormat('ccc, d LLL');
}

// "2026-09-28" + 1 -> "2026-09-29"
export function addDays(date, days) {
  return DateTime.fromISO(date).plus({ days }).toISODate();
}
