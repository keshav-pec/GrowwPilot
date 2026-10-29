import toast from 'react-hot-toast';
import { Gift } from 'lucide-react';
import { useInvoiceOffers, useSetInvoiceOffer } from '../../../api/invoices';
import { formatMoney } from '../../../lib/money';
import { formatDate } from '../../../lib/time';
import { Badge, Button } from '../../../components/ui';

// Checkout: the customer's birthday / anniversary offer. The server works out the eligible subtotal, the discount
// and the new payable. One offer per bill; while it is on, other discounts are off. It is used only when the bill
// is issued. onChanged(invoice) gets the re-priced draft.
export default function OfferPanel({ draft, zone, onChanged, onStale }) {
  const offersQuery = useInvoiceOffers(draft._id, draft.version, Boolean(draft.customerId));
  const setOffer = useSetInvoiceOffer();
  const offers = offersQuery.data?.offers ?? [];
  if (!draft.customerId || offers.length === 0) return null;

  function change(offerIssueId) {
    setOffer.mutate(
      { _id: draft._id, version: draft.version, offerIssueId },
      {
        onSuccess: (invoice) => {
          toast.success(offerIssueId ? 'Offer applied' : 'Offer removed');
          onChanged(invoice);
        },
        onError: (err) => {
          toast.error(err.message);
          if (err.code === 'STALE_VERSION') onStale();
        },
      }
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-gold bg-gold/10 p-4 text-sm">
      <p className="mb-3 flex items-center gap-2 font-semibold text-brown">
        <Gift size={16} /> Available occasion offer
      </p>
      <ul className="flex flex-col gap-3">
        {offers.map((o) => (
          <li key={o._id} className="rounded-lg bg-bg p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {o.label}: {o.offerSummary}
                </p>
                <p className="text-xs text-muted">
                  {o.campaignName} · valid till {formatDate(o.validUntil, zone)}
                  {o.linked && ' · linked to this booking'}
                </p>
              </div>
              {o.applied ? (
                <span className="flex items-center gap-2">
                  <Badge tone="gold">Applied</Badge>
                  <Button size="sm" variant="ghost" onClick={() => change(null)} loading={setOffer.isPending}>
                    Remove
                  </Button>
                </span>
              ) : (
                o.canApply && (
                  <Button size="sm" onClick={() => change(o._id)} loading={setOffer.isPending} disabled={Boolean(draft.offer)}>
                    Apply offer
                  </Button>
                )
              )}
            </div>
            {(o.canApply || o.applied) && o.discount != null && (
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted">Eligible services</dt>
                  <dd className="font-medium">{formatMoney(o.eligibleSubtotal)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Offer</dt>
                  <dd className="font-medium">−{formatMoney(o.applied ? draft.offer.discount : o.discount)}</dd>
                </div>
                <div>
                  <dt className="text-muted">New payable</dt>
                  <dd className="font-medium">{formatMoney(o.applied ? draft.grandTotal : o.payable)}</dd>
                </div>
              </dl>
            )}
            {!o.canApply && !o.applied && o.reason && <p className="mt-2 text-xs text-orange">{o.reason}</p>}
          </li>
        ))}
      </ul>
      {draft.offer && <p className="mt-3 text-xs text-muted">Other discounts are switched off while an occasion offer is on the bill. Only one offer per bill.</p>}
      {draft.offer && !draft.offer.eligible && <p className="mt-2 text-xs text-danger">The offer no longer applies to this bill. Remove it, or add the services it needs.</p>}
    </div>
  );
}
