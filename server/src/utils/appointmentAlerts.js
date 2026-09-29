// Warnings for today's appointments (plan 4.3). The day board shows the same rules on screen.
//   Possible no-show: still Booked 15+ minutes after the start time
//   Waiting:          Arrived, but the service hasn't started 10+ minutes after the start time
//   Running late:     past the planned end time and still not Completed or Cancelled
// Returns 'NO_SHOW' | 'WAITING' | 'RUNNING_LATE' | null
export function getAppointmentAlert(appointment, now = new Date()) {
  const minutesSinceStart = (now - appointment.startAt) / 60_000;

  if (appointment.status === 'BOOKED' && minutesSinceStart >= 15) return 'NO_SHOW';
  if (appointment.status === 'ARRIVED' && minutesSinceStart >= 10) return 'WAITING';
  if (['BOOKED', 'ARRIVED', 'IN_SERVICE'].includes(appointment.status) && now > appointment.endAt) return 'RUNNING_LATE';
  return null;
}
