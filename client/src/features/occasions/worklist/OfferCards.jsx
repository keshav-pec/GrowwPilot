import { occasionLine } from '../../../lib/occasions';
import { ContactBadge, OfferLine, OfferStatusBadge, TaskLine } from './OfferBits';

// The occasion list on narrow screens (tablets, phones): one card per customer
export default function OfferCards({ offers, zone, showBranch, onOpen, empty }) {
  if (offers.length === 0) return empty;
  return (
    <ul className="flex flex-col gap-3">
      {offers.map((o) => (
        <li key={o._id}>
          <button type="button" onClick={() => onOpen(o._id)} className="w-full rounded-xl border border-border p-4 text-left hover:bg-surface">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span>
                <span className="font-medium">{o.customerName}</span>
                <span className="block text-xs text-muted">
                  {o.phone}
                  {showBranch && o.homeBranchName && ` · ${o.homeBranchName}`}
                </span>
              </span>
              <OfferStatusBadge status={o.status} />
            </div>
            <p className="mb-2 text-sm text-muted">{occasionLine(o)}</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <OfferLine offer={o} zone={zone} />
              <ContactBadge offer={o} />
              <TaskLine offer={o} />
              <span>{o.booked ? 'Booked' : 'Not booked'}</span>
            </div>
            {o.nextAction && <p className="mt-3 text-sm font-medium text-brown">Next: {o.nextAction}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}
