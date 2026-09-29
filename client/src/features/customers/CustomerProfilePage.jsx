import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, Pencil } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useCustomerProfile } from '../../api/customers';
import { staffNames } from '../../lib/appointments';
import { formatMoney } from '../../lib/money';
import { formatDate, formatDateTime } from '../../lib/time';
import { Button, Card, EmptyState, PageHeader, Spinner, Table, Tabs } from '../../components/ui';
import AppointmentStatusBadge from '../../components/AppointmentStatusBadge';
import AppointmentDrawer from '../appointments/AppointmentDrawer';
import CustomerFormModal from './CustomerFormModal';

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold text-brown">{value}</p>
    </div>
  );
}

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeBranch, activeBranchId } = useAuth();
  const profileQuery = useCustomerProfile(id);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'past' ? 'past' : 'upcoming';
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  if (profileQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (profileQuery.isError) {
    return <EmptyState title="Customer not found" message={profileQuery.error.message} action={<Link to="/app/customers" className="text-sm underline">All customers</Link>} />;
  }

  const { customer, stats, upcoming, past } = profileQuery.data;
  const preferred = customer.preferredStaffId; // { _id, name } or null
  const rows = tab === 'upcoming' ? upcoming : past;
  const selected = [...upcoming, ...past].find((a) => a._id === selectedId);

  // "Book again": open the booking form with this customer (and their preferred stylist) filled in
  function bookAgain() {
    const params = new URLSearchParams({ customerId: customer._id });
    if (preferred) params.set('staffId', preferred._id);
    navigate(`/app/appointments/new?${params}`);
  }

  const columns = [
    // Each appointment is shown in its own branch's time
    { key: 'when', header: 'When', render: (a) => formatDateTime(a.startAt, a.branchTimezone) },
    { key: 'services', header: 'Services', render: (a) => a.items.map((i) => i.serviceName).join(', ') },
    { key: 'staff', header: 'Stylist', render: staffNames },
    { key: 'branch', header: 'Branch', render: (a) => a.branchName },
    { key: 'total', header: 'Total', render: (a) => formatMoney(a.totalPrice) },
    { key: 'status', header: 'Status', render: (a) => <AppointmentStatusBadge status={a.status} /> },
  ];

  return (
    <>
      <Link to="/app/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> All customers
      </Link>

      <PageHeader
        title={customer.name}
        subtitle={customer.phone}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Edit
            </Button>
            <Button onClick={bookAgain}>
              <CalendarPlus size={16} /> Book again
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Email">{customer.email}</Detail>
            {/* dob is saved as midnight UTC, so show it in UTC to avoid slipping a day */}
            <Detail label="Date of birth">{customer.dob && formatDate(customer.dob, 'UTC')}</Detail>
            <Detail label="Preferred stylist">{preferred?.name}</Detail>
            <Detail label="Customer since">{formatDate(customer.createdAt, activeBranch.timezone)}</Detail>
            <div className="sm:col-span-2">
              <Detail label="Notes">{customer.notes && <span className="whitespace-pre-wrap">{customer.notes}</span>}</Detail>
            </div>
          </dl>
        </Card>

        <Card title="At a glance">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Total visits" value={stats.totalVisits} />
            <Stat label="Total spend" value={formatMoney(stats.totalSpend)} />
            <div className="col-span-2">
              <Stat label="Last visit" value={stats.lastVisitAt ? formatDate(stats.lastVisitAt, activeBranch.timezone) : 'Not yet'} />
            </div>
          </div>
        </Card>
      </div>

      <Tabs
        tabs={[
          { value: 'upcoming', label: `Upcoming (${upcoming.length})` },
          { value: 'past', label: `Past (${past.length})` },
        ]}
        value={tab}
        onChange={(value) => setSearchParams({ tab: value }, { replace: true })}
      />
      <Table
        columns={columns}
        rows={rows}
        // Appointments at the selected branch can be opened; others are shown for history only
        onRowClick={(a) => a.branchId === activeBranchId && setSelectedId(a._id)}
        empty={<EmptyState title={tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'} action={tab === 'upcoming' && <Button onClick={bookAgain}>Book now</Button>} />}
      />

      {editing && <CustomerFormModal customer={customer} onClose={() => setEditing(false)} />}
      {selected && <AppointmentDrawer appointment={selected} onClose={() => setSelectedId(null)} />}
    </>
  );
}
