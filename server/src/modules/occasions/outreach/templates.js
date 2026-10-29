import { DateTime } from 'luxon';
import { describeOffer } from '../campaigns/campaign.rules.js';

// The ready-made offer messages staff send from their own phone. Owners can change the wording per campaign,
// but it must keep the customer's name, the salon, the offer, the expiry date and the opt-out line.
// There is no public booking page yet, so messages end with "Reply or call {salon_phone} to book".

export const PLACEHOLDERS = ['{first_name}', '{salon_name}', '{offer_summary}', '{expiry_date}'];
export const OPT_OUT = /opt[\s-]?out/i;

const GREETING = { BIRTHDAY: 'Happy birthday month', ANNIVERSARY: 'Happy anniversary month' };
const TREAT = { BIRTHDAY: 'A birthday treat', ANNIVERSARY: 'An anniversary treat' };

export function defaultMessages(type) {
  const greeting = GREETING[type] ?? 'Hello';
  return {
    WHATSAPP: { body: `Hi {first_name}! ${greeting} from {salon_name}. Enjoy {offer_summary} on your visit, valid till {expiry_date}. Reply or call {salon_phone} to book. Reply STOP to opt out.` },
    SMS: { body: `Hi {first_name}, ${greeting.toLowerCase()} from {salon_name}! Get {offer_summary} till {expiry_date}. Reply or call {salon_phone} to book. Reply STOP to opt out` },
    EMAIL: {
      subject: `${TREAT[type] ?? 'A treat'} from {salon_name}`,
      body: `Hi {first_name},\n\n${greeting} from all of us at {salon_name}! Enjoy {offer_summary} on your visit, valid till {expiry_date}.\n\nReply or call {salon_phone} to book.\n\nOpt-out: reply to this email with STOP and we won’t send you offers again.`,
    },
  };
}

// The campaign's wording, with the defaults for anything it doesn't have
export function campaignMessages(campaign) {
  const defaults = defaultMessages(campaign.type);
  const saved = campaign.messages ?? {};
  return {
    WHATSAPP: { body: saved.WHATSAPP?.body || defaults.WHATSAPP.body },
    SMS: { body: saved.SMS?.body || defaults.SMS.body },
    EMAIL: { subject: saved.EMAIL?.subject || defaults.EMAIL.subject, body: saved.EMAIL?.body || defaults.EMAIL.body },
  };
}

// Problems with edited wording: [{ channel, message }]
export function checkMessages(messages) {
  const problems = [];
  for (const [channel, { body }] of Object.entries(messages)) {
    const missing = PLACEHOLDERS.filter((p) => !body.includes(p));
    if (missing.length) problems.push({ channel, message: `The ${channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'SMS' ? 'SMS' : 'email'} message must keep ${missing.join(', ')}` });
    if (!OPT_OUT.test(body)) problems.push({ channel, message: `The ${channel === 'EMAIL' ? 'email' : channel === 'SMS' ? 'SMS' : 'WhatsApp'} message must keep the opt-out line` });
  }
  return problems;
}

// Short, safe text for a placeholder: no line breaks, no braces, at most `max` characters
const safe = (text, max) => String(text ?? '').replace(/[{}\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The values that go into a message. Never the birth year (the app doesn't keep it).
export function messageValues({ customerName, salonName, salonPhone, rules, validUntil, zone }) {
  return {
    '{first_name}': safe(String(customerName ?? '').split(' ')[0], 30) || 'there',
    '{salon_name}': safe(salonName, 60),
    '{offer_summary}': safe(describeOffer(rules), 80),
    '{expiry_date}': DateTime.fromJSDate(validUntil, { zone }).toFormat('d LLL yyyy'),
    '{salon_phone}': safe(salonPhone, 20) || 'us',
  };
}

export function fillMessage(text, values) {
  return Object.entries(values).reduce((out, [key, value]) => out.replaceAll(key, value), text);
}
