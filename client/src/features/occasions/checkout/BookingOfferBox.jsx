import { DateTime } from 'luxon';
import { AlertTriangle, Gift } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useLiveOffers } from '../../../api/occasions';
import { formatMoney } from '../../../lib/money';
import { formatDate } from '../../../lib/time';

// Booking form: "Eligible occasion offer" once a customer is picked. Booking does not use the offer.
// Ticking it (or coming from the occasion list) links the booking to the offer.
// value: the linked offer's id ('' = none); onChange(id)
export default function BookingOfferBox({ customerId, serviceIds, isCombo, date, value, onChange }) {
  const { user, activeBranch } = useAuth();
  const on = Boolean(user.org?.occasionOffers?.enabled);
  const offersQuery = useLiveOffers(customerId, isCombo ? [] : serviceIds, on);
  const offers = offersQuery.data ?? [];
  if (!on || offers.length === 0) return null;
  const zone = activeBranch.timezone;

  return (
    <div className="rounded-xl border border-gold bg-gold/10 p-4 text-sm">
      <p className="mb-2 flex items-center gap-2 font-semibold text-brown">
        <Gift size={16} /> Eligible occasion offer
      </p>
      <ul className="flex flex-col gap-3">
        {offers.map((o) => {
          const lastDay = DateTime.fromISO(o.validUntil, { zone }).toISODate();
          const tooLate = date && date > lastDay;
          return (
            <li key={o._id}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 accent-gold" checked={value === o._id} onChange={(e) => onChange(e.target.checked ? o._id : '')} />
                <span>
                  <span className="font-medium">
                    {o.label}: {o.offerSummary}
                  </span>
                  <span className="block text-xs text-muted">
                    {o.maxDiscount ? `Up to ${formatMoney(o.maxDiscount)} · ` : ''}valid till {formatDate(o.validUntil, zone)} · Booking does not use the offer.
                  </span>
                  {serviceIds.length > 0 && (
                    <span className="mt-1 block text-xs">
                      {isCombo
                        ? 'Combo services don’t count for this offer.'
                        : o.potentialDiscount
                          ? `Potential offer: −${formatMoney(o.potentialDiscount)} on the chosen services`
                          : o.potentialReason}
                    </span>
                  )}
                  {tooLate && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-orange">
                      <AlertTriangle size={12} /> This date is after the offer ends; it will have expired by then.
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
