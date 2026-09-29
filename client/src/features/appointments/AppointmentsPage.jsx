import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarPlus, CalendarX, Search } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAppointments } from '../../api/appointments';
import { useStaff } from '../../api/staff';
import { STATUS_LABEL, staffNames } from '../../lib/appointments';
import { useDebounce } from '../../lib/useDebounce';
import { formatMoney } from '../../lib/money';
import { formatDate, formatTime, todayIn } from '../../lib/time';
import { Button, EmptyState, Input, PageHeader, Select, Table } from '../../components/ui';
import AppointmentStatusBadge from '../../components/AppointmentStatusBadge';
import AppointmentDrawer from './AppointmentDrawer';

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));

// The list view: for searching and filtering. Filters live in the URL, so a refresh keeps them.
export default function AppointmentsPage() {
  const navigate = useNavigate();
  const { activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const [searchParams, setSearchParams] = useSearchParams();

  // date: missing = today, "all" = every date
  const dateParam = searchParams.get('date') || todayIn(zone);
  const status = searchParams.get('status') || '';
  const staffId = searchParams.get('staffId') || '';

  // The search box updates the URL 300 ms after typing stops
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search);
  useEffect(() => {
    setFilter('search', debouncedSearch);
  }, [debouncedSearch]);

  function setFilter(key, value) {
    setSearchParams(
      (params) => {
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true }
    );
  }

  const appointmentsQuery = useAppointments({
    date: dateParam === 'all' ? undefined : dateParam,
    status: status || undefined,
    staffId: staffId || undefined,
    search: debouncedSearch || undefined,
  });
  const staffQuery = useStaff();
  const [selectedId, setSelectedId] = useState(null);
  const selected = appointmentsQuery.data?.find((a) => a._id === selectedId);

  const columns = [
    {
      key: 'when',
      header: 'When',
      render: (a) => (
        <div>
          <p className="font-medium">{formatTime(a.startAt, zone)}</p>
          {dateParam === 'all' && <p className="text-xs text-muted">{formatDate(a.startAt, zone)}</p>}
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (a) => (
        <div>
          <p>{a.customerSnapshot.name}</p>
          <p className="text-xs text-muted">{a.customerSnapshot.phone}</p>
        </div>
      ),
    },
    { key: 'services', header: 'Services', render: (a) => a.items.map((i) => i.serviceName).join(', ') },
    { key: 'staff', header: 'Stylist', render: staffNames },
    { key: 'total', header: 'Total', render: (a) => formatMoney(a.totalPrice) },
    { key: 'status', header: 'Status', render: (a) => <AppointmentStatusBadge status={a.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle={activeBranch.name}
        actions={
          <Button onClick={() => navigate('/app/appointments/new')}>
            <CalendarPlus size={16} /> New booking
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <Input placeholder="Customer name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Input
            type="date"
            value={dateParam === 'all' ? '' : dateParam}
            onChange={(e) => setFilter('date', e.target.value || 'all')}
          />
          <Button variant={dateParam === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('date', dateParam === 'all' ? '' : 'all')}>
            All dates
          </Button>
        </div>
        <Select placeholder="All statuses" options={STATUS_OPTIONS} value={status} onChange={(e) => setFilter('status', e.target.value)} />
        <Select
          placeholder="All stylists"
          options={(staffQuery.data ?? []).map((s) => ({ value: s._id, label: s.name }))}
          value={staffId}
          onChange={(e) => setFilter('staffId', e.target.value)}
        />
      </div>

      {appointmentsQuery.isError ? (
        <p className="text-sm text-danger">{appointmentsQuery.error.message}</p>
      ) : (
        <Table
          columns={columns}
          rows={appointmentsQuery.data}
          loading={appointmentsQuery.isPending}
          onRowClick={(a) => setSelectedId(a._id)}
          empty={<EmptyState icon={CalendarX} title="No appointments found" message="Try another date or clear the filters." />}
        />
      )}

      {selected && <AppointmentDrawer appointment={selected} onClose={() => setSelectedId(null)} />}
    </>
  );
}
