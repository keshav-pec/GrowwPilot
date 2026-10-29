import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useOffer } from '../../../api/occasions';
import { CHANNEL_LABEL, CONSENT_STATUS, OFFER_EVENT_LABEL, occasionLine, taskLabel } from '../../../lib/occasions';
import { formatDate, formatDateTime } from '../../../lib/time';
import { Badge, Drawer, EmptyState, Spinner } from '../../../components/ui';
import { OfferStatusBadge } from './OfferBits';

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

// One customer's offer: occasion, frozen terms, expiry, messaging permission, task and timeline.
// Read-only for now; the buttons (send, record a call, assign, book) come next.
export default function OfferDrawer({ offerId, zone, onClose }) {
  const offerQuery = useOffer(offerId);
  const data = offerQuery.data;
  return (
    <Drawer
      open
      size="wide"
      onClose={onClose}
      title={data ? data.offer.customerName : 'Offer'}
      footer={
        data && (
          <Link to={`/app/customers/${data.offer.customerId}`} className="w-full rounded-lg border border-border px-4 py-2 text-center text-sm font-medium hover:bg-surface sm:w-auto">
            Open customer profile
          </Link>
        )
      }
    >
      {offerQuery.isPending ? (
        <Spinner />
      ) : offerQuery.isError ? (
        <EmptyState title="Couldn’t open this offer" message={offerQuery.error.message} />
      ) : (
        <Details data={data} zone={data.offer.branchTimezone ?? zone} />
      )}
    </Drawer>
  );
}

function Details({ data, zone }) {
  const { offer, permission, events } = data;
  const canMessage = permission.some((p) => p.status === 'OPTED_IN' && p.available);
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-brown">{occasionLine(offer)}</h3>
          <OfferStatusBadge status={offer.status} />
        </div>
        <dl>
          <Row label="Offer">{offer.offerSummary}</Row>
          <Row label="Campaign">{offer.campaignName}</Row>
          <Row label="Valid">
            {formatDate(offer.validFrom, zone)} – {formatDate(offer.validUntil, zone)}
          </Row>
          <Row label="Home branch">{offer.homeBranchName}</Row>
          {offer.revokedReason && <Row label="Withdrawn because">{offer.revokedReason}</Row>}
        </dl>
        <p className="mt-2 text-xs text-muted">These terms are fixed for this offer, even if the campaign is changed later.</p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-brown">Messaging permission</h3>
        <ul className="flex flex-wrap gap-2">
          {permission.map((p) => (
            <li key={p.channel}>
              <Badge tone={CONSENT_STATUS[p.status].tone}>
                {CHANNEL_LABEL[p.channel]}: {CONSENT_STATUS[p.status].label}
              </Badge>
            </li>
          ))}
        </ul>
        {!canMessage && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-surface p-3 text-sm text-muted">
            <Info size={16} className="mt-0.5 shrink-0" />
            Offer available in salon. Promotional message disabled: permission not recorded. Ask for permission at the next visit.
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-brown">Task</h3>
        <dl>
          <Row label="Step">{taskLabel(offer)}</Row>
          {offer.task?.dueAt && offer.task.state === 'OPEN' && <Row label="Due">{formatDateTime(offer.task.dueAt, zone)}</Row>}
          <Row label="Assigned to">{offer.task?.assigneeName ?? 'Anyone at the branch'}</Row>
          {offer.nextAction && <Row label="Next action">{offer.nextAction}</Row>}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-brown">Timeline</h3>
        <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
          {events.map((e) => (
            <li key={e._id} className="text-sm">
              <p className="font-medium">{OFFER_EVENT_LABEL[e.kind] ?? e.kind}</p>
              <p className="text-xs text-muted">
                {formatDateTime(e.createdAt, zone)} · {e.actorName}
              </p>
              {e.note && <p className="text-xs">{e.note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
