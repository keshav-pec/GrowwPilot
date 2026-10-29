import { CHANNEL_LABEL, OFFER_STATUS, taskLabel } from '../../../lib/occasions';
import { formatDate } from '../../../lib/time';
import { Badge } from '../../../components/ui';

// Small pieces shared by the table, the cards and the drawer

export function OfferStatusBadge({ status }) {
  return <Badge tone={OFFER_STATUS[status].tone}>{OFFER_STATUS[status].label}</Badge>;
}

// "WhatsApp, SMS" or "In-salon only" (no permission recorded)
export function ContactBadge({ offer }) {
  if (offer.canMessage) return <span className="text-sm">{offer.channels.map((c) => CHANNEL_LABEL[c]).join(', ')}</span>;
  return <Badge>In-salon only</Badge>;
}

export function OfferLine({ offer, zone }) {
  return (
    <span>
      <span className="font-medium">{offer.offerSummary}</span>
      <span className="block text-xs text-muted">Until {formatDate(offer.validUntil, zone)}</span>
    </span>
  );
}

export function TaskLine({ offer }) {
  return (
    <span>
      {taskLabel(offer)}
      {offer.task?.assigneeName && <span className="block text-xs text-muted">{offer.task.assigneeName}</span>}
    </span>
  );
}
