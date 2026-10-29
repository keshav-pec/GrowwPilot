import { DateTime } from 'luxon';

// What a recorded call does to the task. Pure. A call never counts as a promotional message and never needs
// messaging permission.
//   Reached        -> contacted (a "tell them it was withdrawn" task is done)
//   No answer      -> one follow-up the next day at 11:00; a second no answer closes the task as Unreachable
//   Not interested -> closed
//   Call later     -> due at the chosen time (before the offer's month ends)
//   Wrong details  -> closed; the screen asks to fix the number
// Returns { set: { 'task.x': ... }, note, fixDetails? } or throws { code, message } via the `refuse` callback.

const LABEL = { REACHED: 'Reached', NO_ANSWER: 'No answer', NOT_INTERESTED: 'Not interested', CALL_LATER: 'Call later', WRONG_DETAILS: 'Wrong details' };

export function applyOutcome(task, { outcome, callbackAt }, { now, zone, validUntil, refuse }) {
  const set = { 'task.outcome': outcome };
  const close = (reason) => Object.assign(set, { 'task.state': 'CLOSED', 'task.closedReason': reason, 'task.closedAt': now });
  const reached = () => Object.assign(set, { 'task.contactedAt': task.contactedAt ?? now });
  const when = (date) => DateTime.fromJSDate(date, { zone }).toFormat('d LLL, h:mm a');

  if (task.kind === 'WITHDRAWN_NOTICE' && outcome === 'REACHED') {
    close('TOLD');
    return { set, note: 'Customer told the offer was withdrawn' };
  }
  switch (outcome) {
    case 'REACHED':
      reached();
      Object.assign(set, { 'task.state': 'CONTACTED' });
      return { set, note: LABEL.REACHED };
    case 'NO_ANSWER': {
      const attempts = (task.attempts ?? 0) + 1;
      set['task.attempts'] = attempts;
      if (attempts >= 2) {
        close('UNREACHABLE');
        return { set, note: `No answer (${attempts} times): closed as unreachable` };
      }
      const followUp = DateTime.fromJSDate(now, { zone }).plus({ days: 1 }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate();
      Object.assign(set, { 'task.state': 'OPEN', 'task.dueAt': followUp });
      return { set, note: `No answer: follow up ${when(followUp)}` };
    }
    case 'NOT_INTERESTED':
      reached();
      close('NOT_INTERESTED');
      return { set, note: LABEL.NOT_INTERESTED };
    case 'CALL_LATER': {
      const at = callbackAt ? new Date(callbackAt) : null;
      if (!at || Number.isNaN(at.getTime())) refuse('CALLBACK_REQUIRED', 'Choose when to call back');
      if (at <= now) refuse('CALLBACK_IN_PAST', 'Choose a time in the future');
      if (at > validUntil) refuse('CALLBACK_AFTER_EXPIRY', 'Choose a time before the offer ends');
      reached();
      Object.assign(set, { 'task.state': 'OPEN', 'task.dueAt': at });
      return { set, note: `Call later: ${when(at)}` };
    }
    case 'WRONG_DETAILS':
      close('WRONG_DETAILS');
      return { set, note: 'Wrong details: the number needs fixing', fixDetails: true };
    default:
      return refuse('VALIDATION_ERROR', 'Choose what happened');
  }
}
