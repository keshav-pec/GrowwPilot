import { PHONE_REGEX } from '../../../utils/phone.js';
import { PROMO_GAP_DAYS } from '../../../config/occasions.js';

// May staff send this offer message now, and on which channel? Pure: everything it needs is passed in.
// Checked when the drawer opens and again on the server at the moment of sending.
//
// offer: the OfferIssue; customer: { phone, email, marketing }; channelOrder: the salon's order;
// birthdayFirst: true when the same customer has a birthday offer this month that hasn't been messaged yet
// (with both occasions in one month, the birthday goes first and the anniversary waits).
// Returns { allowed, channels: [allowed channels in order], channel, code?, reason?, nextAllowedAt? }

const GAP_MS = PROMO_GAP_DAYS * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hasDestination(customer, channel) {
  return channel === 'EMAIL' ? EMAIL.test(customer.email ?? '') : PHONE_REGEX.test(customer.phone ?? '');
}

export function checkSend({ offer, customer, channelOrder, now = new Date(), inMyBranches = true, birthdayFirst = false }) {
  const refuse = (code, reason, extra = {}) => ({ allowed: false, channels: [], channel: null, code, reason, ...extra });
  if (!inMyBranches) return refuse('NOT_YOUR_BRANCH', 'This customer belongs to another branch');
  if (offer.status === 'REVOKED') return refuse('OFFER_WITHDRAWN', 'This offer was withdrawn');
  if (offer.status === 'REDEEMED') return refuse('OFFER_USED', 'This offer has already been used');
  if (offer.status !== 'ISSUED' || offer.validUntil < now) return refuse('OFFER_EXPIRED', 'This offer has expired');

  const optedIn = channelOrder.filter((c) => customer.marketing?.[c]?.status === 'OPTED_IN');
  if (optedIn.length === 0) return refuse('NO_PERMISSION', 'Offer available in salon. Promotional message disabled: permission not recorded.');
  const channels = optedIn.filter((c) => hasDestination(customer, c));
  if (channels.length === 0) return refuse('NO_DESTINATION', 'No valid mobile number or email for the channels the customer allowed');

  const last = customer.marketing?.lastPromoAt ? new Date(customer.marketing.lastPromoAt) : null;
  if (last && now - last < GAP_MS) {
    const nextAllowedAt = new Date(last.getTime() + GAP_MS);
    return refuse('RECENTLY_CONTACTED', 'Customer contacted recently; next promotional contact permitted on', { nextAllowedAt });
  }
  if (birthdayFirst) return refuse('BIRTHDAY_FIRST', 'Send the birthday offer first; the anniversary offer can follow after 7 days');
  return { allowed: true, channels, channel: channels[0] };
}

// The link that opens the customer's app with the message filled in (Indian mobile numbers, as in bill sharing)
export function sendLink(channel, customer, { subject, body }) {
  if (channel === 'WHATSAPP') return `https://wa.me/91${customer.phone}?text=${encodeURIComponent(body)}`;
  if (channel === 'SMS') return `sms:+91${customer.phone}?body=${encodeURIComponent(body)}`;
  return `mailto:${customer.email}?subject=${encodeURIComponent(subject ?? '')}&body=${encodeURIComponent(body)}`;
}

// "98******10" / "pr***@gmail.com"
export function maskedDestination(channel, customer) {
  if (channel === 'EMAIL') {
    const [name, domain] = String(customer.email ?? '').split('@');
    return `${name.slice(0, 2)}***@${domain ?? ''}`;
  }
  const phone = String(customer.phone ?? '');
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}
