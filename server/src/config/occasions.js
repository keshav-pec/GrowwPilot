// Birthday & Anniversary Offers: the fixed lists and small date rules.

export const OCCASION_TYPES = ['BIRTHDAY', 'ANNIVERSARY'];
// Where a birthday or anniversary came from
export const DATE_SOURCES = ['CUSTOMER', 'STAFF', 'IMPORTED', 'MIGRATED'];

// Messaging permission: one status per channel. UNKNOWN = never recorded, and counts as "no".
export const CONSENT_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL'];
export const CONSENT_STATUSES = ['UNKNOWN', 'OPTED_IN', 'OPTED_OUT'];
// How the permission (or its withdrawal) was given. DATA_REMOVAL = "Remove occasion data" by the business owner.
export const CONSENT_SOURCES = ['CUSTOMER_FORM', 'IN_SALON', 'CUSTOMER_REQUEST', 'DATA_REMOVAL'];

export const DEFAULT_CONSENT_TEXT = 'I agree to receive salon offers and promotions from {salon_name} on {channel}. I can opt out at any time.';
export const CHANNEL_LABELS = { WHATSAPP: 'WhatsApp', SMS: 'SMS', EMAIL: 'Email' };

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// The most days each month can have. February allows 29, so a 29 Feb birthday can be saved.
export const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function dayFitsMonth(month, day) {
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= MAX_DAYS[month - 1];
}

// { month: 11, day: null } -> "November (day not provided)"; { month: 2, day: 29 } -> "29 February"
export function describeOccasionDate(date) {
  if (!date?.month) return 'not set';
  const month = MONTH_NAMES[date.month - 1];
  return date.day ? `${date.day} ${month}` : `${month} (day not provided)`;
}


// Campaigns
export const CAMPAIGN_SCOPES = ['BUSINESS_DEFAULT', 'BRANCH_ONLY']; // all branches, or one branch (overrides the salon-wide one)
export const CAMPAIGN_STATUSES = ['DRAFT', 'PUBLISHED', 'DISABLED', 'ARCHIVED'];
export const DISCOUNT_TYPES = ['PERCENT', 'FLAT'];
// STAFF_ASSISTED: staff send every message. AUTO_EMAIL: the app emails customers who allow email (within the send
// hours and a daily limit); customers who allow only WhatsApp / SMS stay on the staff list.
export const DELIVERY_MODES = ['STAFF_ASSISTED', 'AUTO_EMAIL'];
export const DELIVERY_LABELS = { STAFF_ASSISTED: 'staff sends offers', AUTO_EMAIL: 'offer emails are sent automatically' };
// Automatic offer emails: at most this many per salon per 24 hours, only between these hours (branch time)
export const AUTO_EMAIL_DEFAULTS = { dailyLimit: 30, sendFrom: '10:00', sendUntil: '19:00' };
export const OCCASION_LABELS = { BIRTHDAY: 'Birthday', ANNIVERSARY: 'Anniversary' };

// Offers given to customers
export const OFFER_STATUSES = ['ISSUED', 'REDEEMED', 'EXPIRED', 'REVOKED', 'SUPERSEDED'];
export const TASK_STATES = ['OPEN', 'CONTACTED', 'CLOSED'];
// CONTACT: get in touch about the offer. WITHDRAWN_NOTICE: tell a contacted customer the offer was withdrawn.
export const TASK_KINDS = ['CONTACT', 'WITHDRAWN_NOTICE'];
export const OFFER_EVENT_KINDS = ['ISSUED', 'ASSIGNED', 'CONTACT', 'SENT', 'BOOKED', 'REDEEMED', 'RESTORED', 'EXPIRED', 'REVOKED', 'SUPERSEDED', 'MOVED', 'EMAIL_SENT', 'EMAIL_FAILED'];
// An offer email sent by the app: waiting in the outbox, delivered to Gmail, or not sent
export const EMAIL_SEND_STATUSES = ['QUEUED', 'SENT', 'FAILED'];

// Staff follow-up
export const CALL_OUTCOMES = ['REACHED', 'NO_ANSWER', 'NOT_INTERESTED', 'CALL_LATER', 'WRONG_DETAILS'];
export const PROMO_GAP_DAYS = 7; // at most one promotional message per customer per 7 days
