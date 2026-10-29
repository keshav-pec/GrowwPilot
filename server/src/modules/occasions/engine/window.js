import { DateTime } from 'luxon';

// Time rules for offers, worked out in the issuing branch's time zone. Pure functions.

// Which year and month it is now at the branch
export function localMonth(now, zone) {
  const local = DateTime.fromJSDate(now, { zone });
  return { year: local.year, month: local.month };
}

// An offer is valid from the 1st 00:00 to the last day 23:59:59.999 of the month, at the branch (stored in UTC).
// February birthdays (29 Feb too) get the whole of February every year.
export function monthWindow(year, month, zone) {
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone }).startOf('day');
  return { validFrom: start.toUTC().toJSDate(), validUntil: start.endOf('month').toUTC().toJSDate() };
}

// When the front desk should follow up: an offer given on the 1st is due that day at 10:00; one given later
// (a new customer, a corrected date) the next day at 10:00. Every day counts as a working day.
export function taskDueAt(now, zone) {
  const local = DateTime.fromJSDate(now, { zone });
  const day = local.day === 1 ? local : local.plus({ days: 1 });
  return day.set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate();
}

// The offer engine runs from 01:00 branch time
export const RUN_FROM_HOUR = 1;
export function localDay(now, zone) {
  const local = DateTime.fromJSDate(now, { zone });
  return { date: local.toISODate(), hour: local.hour };
}
