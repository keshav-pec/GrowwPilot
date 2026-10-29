import { DateTime } from 'luxon';
import { useAuth } from '../../../auth/AuthContext';
import { useLiveOffers } from '../../../api/occasions';
import { Badge } from '../../../components/ui';

// Check-in reminder on the appointment: "Birthday offer available till 30 Nov", without opening the offers page.
// A booking made from the occasion list also says it is linked (the offer isn't used until the bill).
export default function OfferBadges({ appointment, zone }) {
  const { user } = useAuth();
  const on = Boolean(user.org?.occasionOffers?.enabled);
  const open = appointment.status !== 'CANCELLED' && !appointment.invoiceId; // not once it is billed or cancelled
  const offersQuery = useLiveOffers(appointment.customerId, [], on && open);
  const offers = offersQuery.data ?? [];
  return (
    <>
      {offers.map((o) => (
        <Badge key={o._id} tone="gold">
          {o.label} available till {DateTime.fromISO(o.validUntil, { zone }).toFormat('d LLL')}
          {String(appointment.offerIssueId) === String(o._id) ? ' · linked, not used yet' : ''}
        </Badge>
      ))}
    </>
  );
}
