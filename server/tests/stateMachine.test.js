import { describe, expect, it } from 'vitest';
import { APPOINTMENT_TRANSITIONS, LEAD_TRANSITIONS, assertTransition, canTransition } from '../src/utils/stateMachine.js';

describe('Appointment status rules', () => {
  it('allows the normal flow: Booked -> Arrived -> In Service -> Completed', () => {
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'BOOKED', 'ARRIVED')).toBe(true);
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'ARRIVED', 'IN_SERVICE')).toBe(true);
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'IN_SERVICE', 'COMPLETED')).toBe(true);
  });

  it('allows cancelling only before the service starts', () => {
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'BOOKED', 'CANCELLED')).toBe(true);
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'ARRIVED', 'CANCELLED')).toBe(true);
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'IN_SERVICE', 'CANCELLED')).toBe(false);
  });

  it('blocks jumping from Booked straight to Completed', () => {
    expect(() => assertTransition(APPOINTMENT_TRANSITIONS, 'BOOKED', 'COMPLETED')).toThrow(
      "Can't change status from Booked to Completed"
    );
  });

  it('blocks going backwards or leaving a final status', () => {
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'ARRIVED', 'BOOKED')).toBe(false);
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'COMPLETED', 'BOOKED')).toBe(false);
    expect(canTransition(APPOINTMENT_TRANSITIONS, 'CANCELLED', 'BOOKED')).toBe(false);
  });
});

describe('Lead status rules', () => {
  it('moves forward, and may skip ahead', () => {
    expect(canTransition(LEAD_TRANSITIONS, 'NEW', 'CONTACTED')).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, 'NEW', 'INTERESTED')).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, 'CONTACTED', 'INTERESTED')).toBe(true);
  });

  it('never moves backwards', () => {
    expect(canTransition(LEAD_TRANSITIONS, 'INTERESTED', 'NEW')).toBe(false);
    expect(canTransition(LEAD_TRANSITIONS, 'CONTACTED', 'NEW')).toBe(false);
  });

  it('can be marked Lost from any open status, and Lost is final', () => {
    for (const from of ['NEW', 'CONTACTED', 'INTERESTED']) expect(canTransition(LEAD_TRANSITIONS, from, 'LOST')).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, 'LOST', 'NEW')).toBe(false);
  });

  it('never reaches Appointment Booked by a normal status change', () => {
    for (const from of Object.keys(LEAD_TRANSITIONS)) {
      expect(canTransition(LEAD_TRANSITIONS, from, 'APPOINTMENT_BOOKED')).toBe(false);
    }
  });
});
