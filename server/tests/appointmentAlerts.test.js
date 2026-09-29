import { describe, expect, it } from 'vitest';
import { getAppointmentAlert } from '../src/utils/appointmentAlerts.js';

// An appointment that started `startedMinutesAgo` minutes ago and lasts 45 minutes
const now = new Date('2026-09-28T10:00:00Z');
function appointment(status, startedMinutesAgo) {
  const startAt = new Date(now - startedMinutesAgo * 60_000);
  return { status, startAt, endAt: new Date(+startAt + 45 * 60_000) };
}

describe('Appointment warnings (plan 4.3)', () => {
  it('possible no-show: still Booked 15+ minutes after the start', () => {
    expect(getAppointmentAlert(appointment('BOOKED', 14), now)).toBeNull();
    expect(getAppointmentAlert(appointment('BOOKED', 15), now)).toBe('NO_SHOW');
  });

  it('waiting: Arrived, but not started 10+ minutes after the start', () => {
    expect(getAppointmentAlert(appointment('ARRIVED', 9), now)).toBeNull();
    expect(getAppointmentAlert(appointment('ARRIVED', 10), now)).toBe('WAITING');
  });

  it('running late: past the planned end and not finished', () => {
    expect(getAppointmentAlert(appointment('IN_SERVICE', 30), now)).toBeNull();
    expect(getAppointmentAlert(appointment('IN_SERVICE', 50), now)).toBe('RUNNING_LATE');
  });

  it('finished or cancelled appointments never warn', () => {
    expect(getAppointmentAlert(appointment('COMPLETED', 120), now)).toBeNull();
    expect(getAppointmentAlert(appointment('CANCELLED', 120), now)).toBeNull();
  });
});
