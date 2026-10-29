import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, Phone, Send } from 'lucide-react';
import { useOffer, useSendPreview } from '../../../api/occasions';
import { CHANNEL_LABEL, CONSENT_STATUS, OFFER_EVENT_LABEL, occasionLine, taskLabel } from '../../../lib/occasions';
import { formatDate, formatDateTime } from '../../../lib/time';
import { Badge, Button, Drawer, EmptyState, Spinner } from '../../../components/ui';
import { OfferStatusBadge } from './OfferBits';
import OfferNotice from '../followup/OfferNotice';
import SendOfferModal from '../followup/SendOfferModal';
import RecordOutcomeModal from '../followup/RecordOutcomeModal';
import AssignSelect from '../followup/AssignSelect';

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

// One customer's offer: occasion, frozen terms, expiry, messaging permission, task and timeline, with the
// follow-up buttons: Send offer (only when allowed), Record call, Create booking, and Assign.
// The buttons sit at the bottom of the panel (on a phone the panel fills the screen).
export default function OfferDrawer({ offerId, zone, onClose }) {
  const navigate = useNavigate();
  const offerQuery = useOffer(offerId);
  const data = offerQuery.data;
  const running = data?.offer.status === 'ISSUED';
  const previewQuery = useSendPreview(offerId, null, Boolean(running));
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const [fixDetails, setFixDetails] = useState(false);
  const branchZone = data?.offer.branchTimezone ?? zone;
  const withdrawnNotice = data?.offer.status === 'REVOKED' && data.offer.task?.state === 'OPEN';

  return (
    <Drawer
      open
      size="wide"
      onClose={onClose}
      title={data ? data.offer.customerName : 'Offer'}
      footer={
        data && (
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Link to={`/app/customers/${data.offer.customerId}`} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface">
              Profile
            </Link>
            {(running || withdrawnNotice) && (
              <Button variant="secondary" onClick={() => setCalling(true)}>
                <Phone size={16} /> Record call
              </Button>
            )}
            {running && (
              <Button variant="secondary" onClick={() => navigate(`/app/appointments/new?customerId=${data.offer.customerId}&offerId=${data.offer._id}`)}>
                <CalendarPlus size={16} /> Create booking
              </Button>
            )}
            {running && previewQuery.data?.allowed && (
              <Button onClick={() => setSending(true)}>
                <Send size={16} /> Send offer
              </Button>
            )}
          </div>
        )
      }
    >
      {offerQuery.isPending ? (
        <Spinner />
      ) : offerQuery.isError ? (
        <EmptyState title="Couldn’t open this offer" message={offerQuery.error.message} />
      ) : (
        <Details data={data} zone={branchZone} notice={running && previewQuery.data && !previewQuery.data.allowed ? previewQuery.data : null} fixDetails={fixDetails} />
      )}
      {sending && <SendOfferModal offerId={offerId} customerName={data.offer.customerName} zone={branchZone} onClose={() => setSending(false)} />}
      {calling && <RecordOutcomeModal offer={data.offer} zone={branchZone} onClose={() => setCalling(false)} onWrongDetails={() => setFixDetails(true)} />}
    </Drawer>
  );
}

function Details({ data, zone, notice, fixDetails }) {
  const { offer, permission, events } = data;
  const running = offer.status === 'ISSUED' || (offer.status === 'REVOKED' && offer.task?.state === 'OPEN');
  return (
    <div className="flex flex-col gap-5">
      {notice && <OfferNotice notice={notice} zone={zone} />}
      {fixDetails && (
        <p className="rounded-lg border border-orange bg-orange/10 p-3 text-sm">
          The number or email looks wrong.{' '}
          <Link to={`/app/customers/${offer.customerId}`} className="font-medium underline">
            Fix it on the customer’s profile
          </Link>
        </p>
      )}
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
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-brown">Task</h3>
        <dl>
          <Row label="Step">{taskLabel(offer)}</Row>
          {offer.task?.dueAt && offer.task.state === 'OPEN' && <Row label="Due">{formatDateTime(offer.task.dueAt, zone)}</Row>}
          {offer.task?.attempts > 0 && <Row label="Calls with no answer">{offer.task.attempts}</Row>}
          <Row label="Assigned to">{running ? <AssignSelect offer={offer} /> : (offer.task?.assigneeName ?? 'Anyone at the branch')}</Row>
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
