import { useAuth } from '../../auth/AuthContext';
import { useCustomerOffers } from '../../api/occasions';
import { MONTHS, OCCASION_LABEL, OFFER_STATUS } from '../../lib/occasions';
import { formatDate } from '../../lib/time';
import { Badge, Card } from '../../components/ui';

// Customer profile: this year's (and last year's) birthday and anniversary offers and what happened to them
export default function OccasionOffersCard({ customerId }) {
  const { user, activeBranch } = useAuth();
  const offersQuery = useCustomerOffers(customerId);
  if (!user.org?.occasionOffers?.enabled && !offersQuery.data?.length) return null;
  const offers = offersQuery.data ?? [];

  return (
    <Card title="Occasion offers">
      {offers.length === 0 ? (
        <p className="text-sm text-muted">{offersQuery.isPending ? 'Loading…' : 'No birthday or anniversary offer yet.'}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {offers.map((o) => (
            <li key={o._id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {OCCASION_LABEL[o.type]} · {MONTHS[o.month - 1]} {o.year}
                </span>
                <Badge tone={OFFER_STATUS[o.status].tone}>{OFFER_STATUS[o.status].label}</Badge>
              </div>
              <p className="text-xs text-muted">
                {o.offerSummary}
                {o.status === 'ISSUED' && ` · until ${formatDate(o.validUntil, activeBranch.timezone)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
