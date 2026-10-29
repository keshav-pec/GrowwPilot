import { Info } from 'lucide-react';
import { formatDateTime } from '../../../lib/time';

// Why an offer message can't be sent right now, in the words staff see (PRD section 15 states)
const WORDS = {
  NO_PERMISSION: () => ['Offer available in salon. Promotional message disabled: permission not recorded.', 'Ask for permission at the next visit.'],
  RECENTLY_CONTACTED: (n, zone) => [`Customer contacted recently; next promotional contact permitted on ${n.nextAllowedAt ? formatDateTime(n.nextAllowedAt, zone) : 'a later date'}.`, 'You can still call or tell them at their visit.'],
  BIRTHDAY_FIRST: () => ['Send the birthday offer first.', 'The anniversary offer can follow 7 days later.'],
  NO_DESTINATION: () => ['No valid mobile number or email for the channels the customer allowed.', 'Fix the details on the customer profile.'],
  OFFER_EXPIRED: () => ['This offer has expired.'],
  OFFER_WITHDRAWN: () => ['This offer was withdrawn.'],
  OFFER_USED: () => ['This offer has already been used.'],
  NOT_YOUR_BRANCH: () => ['This customer belongs to another branch.'],
};

// notice: { code, reason, nextAllowedAt } from the send preview
export default function OfferNotice({ notice, zone }) {
  const [main, extra] = (WORDS[notice.code] ?? (() => [notice.reason]))(notice, zone);
  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface p-3 text-sm">
      <Info size={16} className="mt-0.5 shrink-0 text-muted" />
      <span>
        {main}
        {extra && <span className="block text-muted">{extra}</span>}
      </span>
    </div>
  );
}
