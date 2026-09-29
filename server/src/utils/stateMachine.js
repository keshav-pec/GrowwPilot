import { AppError } from './AppError.js';

// For each status: the statuses it is allowed to move to next.
// Anything not listed here is blocked, e.g. Booked -> Completed.

//  Booked -> Arrived -> In Service -> Completed
//  Booked or Arrived -> Cancelled
export const APPOINTMENT_TRANSITIONS = {
  BOOKED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_SERVICE', 'CANCELLED'],
  IN_SERVICE: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

//  New -> Contacted -> Interested (forward only, skipping ahead is fine), any open status -> Lost.
//  APPOINTMENT_BOOKED is missing on purpose: only the "Convert to appointment" flow sets it.
export const LEAD_TRANSITIONS = {
  NEW: ['CONTACTED', 'INTERESTED', 'LOST'],
  CONTACTED: ['INTERESTED', 'LOST'],
  INTERESTED: ['LOST'],
  APPOINTMENT_BOOKED: [],
  LOST: [],
};

// "IN_SERVICE" -> "In service"
function label(status) {
  const text = status.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function canTransition(transitions, from, to) {
  return (transitions[from] ?? []).includes(to);
}

export function assertTransition(transitions, from, to) {
  if (!canTransition(transitions, from, to)) {
    throw new AppError(409, 'INVALID_STATUS_CHANGE', `Can't change status from ${label(from)} to ${label(to)}`);
  }
}
