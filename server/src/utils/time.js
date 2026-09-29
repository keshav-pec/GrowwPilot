import { DateTime, IANAZone } from 'luxon';

// All times are saved in UTC. Each branch has a timezone such as 'Asia/Kolkata'.
// These helpers convert between the branch's local time and UTC.

export function isValidTimezone(zone) {
  return IANAZone.isValidZone(zone);
}

// ('2026-09-28', '14:30', 'Asia/Kolkata') -> Date for 2026-09-28 09:00 UTC
export function localToUTC(date, time, zone) {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) throw new Error(`Invalid date/time: ${date} ${time}`);
  return dt.toUTC().toJSDate();
}

// A UTC Date -> Luxon DateTime in the branch's timezone (for display and "what day is it")
export function toBranchTime(date, zone) {
  return DateTime.fromJSDate(date, { zone });
}

// A UTC Date -> "2:30 PM" in the branch's timezone (for messages like "booked from 2:00 PM to 2:45 PM")
export function formatTime(date, zone) {
  return toBranchTime(date, zone).toFormat('h:mm a');
}

// Today's date in the branch's timezone, e.g. '2026-09-28'.
// Late at night in Dubai it can already be tomorrow in Kolkata, so "today" depends on the branch.
export function todayInZone(zone) {
  return DateTime.now().setZone(zone).toISODate();
}

// The start and end (in UTC) of one local day at the branch.
// Used for queries like "all appointments today": { startAt: { $gte: start, $lt: end } }
export function dayRangeUTC(date, zone) {
  const start = DateTime.fromISO(date, { zone }).startOf('day');
  return {
    start: start.toUTC().toJSDate(),
    end: start.plus({ days: 1 }).toUTC().toJSDate(),
  };
}
