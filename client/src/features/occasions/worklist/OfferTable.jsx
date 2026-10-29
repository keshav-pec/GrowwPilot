import { occasionLine } from '../../../lib/occasions';
import { Table } from '../../../components/ui';
import { ContactBadge, OfferLine, OfferStatusBadge, TaskLine } from './OfferBits';

// The occasion list on wide screens. Clicking a row opens the drawer.
export default function OfferTable({ offers, zone, showBranch, onOpen, empty }) {
  const columns = [
    {
      key: 'customer',
      header: 'Customer',
      render: (o) => (
        <span>
          <span className="font-medium">{o.customerName}</span>
          <span className="block text-xs text-muted">
            {o.phone}
            {showBranch && o.homeBranchName && ` · ${o.homeBranchName}`}
          </span>
        </span>
      ),
    },
    { key: 'occasion', header: 'Occasion', render: occasionLine },
    { key: 'offer', header: 'Offer', render: (o) => <OfferLine offer={o} zone={zone} /> },
    { key: 'contact', header: 'Contact', render: (o) => <ContactBadge offer={o} /> },
    { key: 'step', header: 'Staff step', render: (o) => <TaskLine offer={o} /> },
    { key: 'booking', header: 'Booking', render: (o) => (o.booked ? 'Booked' : '—') },
    { key: 'status', header: 'Offer', render: (o) => <OfferStatusBadge status={o.status} /> },
    { key: 'next', header: 'Next action', render: (o) => (o.nextAction ? <span className="font-medium text-brown">{o.nextAction}</span> : '—') },
  ];
  return <Table columns={columns} rows={offers} onRowClick={(o) => onOpen(o._id)} empty={empty} />;
}
