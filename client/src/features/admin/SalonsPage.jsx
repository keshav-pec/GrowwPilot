import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Store } from 'lucide-react';
import { useOrgs } from '../../api/admin';
import { useDebounce } from '../../lib/useDebounce';
import { formatDate } from '../../lib/time';
import { Button, EmptyState, Input, PageHeader, Select, Table } from '../../components/ui';
import SalonStatusBadge from './SalonStatusBadge';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const columns = [
  {
    key: 'name',
    header: 'Salon',
    render: (org) => <span className="font-medium">{org.name}</span>,
  },
  { key: 'city', header: 'City' },
  {
    key: 'owner',
    header: 'Owner',
    render: (org) => (
      <div>
        <p>{org.ownerName}</p>
        <p className="text-xs text-muted">{org.contactEmail}</p>
      </div>
    ),
  },
  { key: 'plan', header: 'Plan', render: (org) => <span className="capitalize">{org.plan}</span> },
  { key: 'status', header: 'Status', render: (org) => <SalonStatusBadge status={org.status} /> },
  { key: 'createdAt', header: 'Onboarded', render: (org) => formatDate(org.createdAt) },
];

export default function SalonsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debouncedSearch = useDebounce(search);

  // Only send filters that have a value
  const orgsQuery = useOrgs({ search: debouncedSearch || undefined, status: status || undefined });
  const hasFilters = Boolean(search || status);

  return (
    <>
      <PageHeader
        title="Salons"
        subtitle="Every salon using GrowwPilot"
        actions={
          <Button onClick={() => navigate('/admin/salons/new')}>
            <Plus size={16} /> Onboard salon
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <Input
            placeholder="Search by salon, city or owner email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="sm:w-44">
          <Select
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>
      </div>

      {orgsQuery.isError ? (
        <p className="text-sm text-danger">{orgsQuery.error.message}</p>
      ) : (
        <Table
          columns={columns}
          rows={orgsQuery.data}
          loading={orgsQuery.isPending}
          onRowClick={(org) => navigate(`/admin/salons/${org._id}`)}
          empty={
            hasFilters ? (
              <EmptyState icon={Search} title="No salons match" message="Try a different search or status." />
            ) : (
              <EmptyState
                icon={Store}
                title="No salons yet"
                message="Onboard the first salon to get started."
                action={<Button onClick={() => navigate('/admin/salons/new')}>Onboard salon</Button>}
              />
            )
          }
        />
      )}
    </>
  );
}
