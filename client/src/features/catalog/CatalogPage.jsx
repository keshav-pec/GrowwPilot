import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Plus, Scissors } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useBranches } from '../../api/branches';
import { useCombos, useServices } from '../../api/catalog';
import { branchLabel } from '../../lib/branches';
import { formatMoney } from '../../lib/money';
import { Button, EmptyState, PageHeader, Table, Tabs } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import ServiceFormModal from './ServiceFormModal';
import ComboFormModal from './ComboFormModal';

const TABS = [
  { value: 'services', label: 'Services' },
  { value: 'combos', label: 'Combos' },
];

export default function CatalogPage() {
  const { user } = useAuth();
  const canEdit = user.allBranches; // only the main owner changes the catalogue
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'combos' ? 'combos' : 'services';

  const servicesQuery = useServices();
  const combosQuery = useCombos();
  const branches = useBranches().data;
  const [editing, setEditing] = useState(null); // null | 'new' | service/combo object

  const serviceColumns = [
    {
      key: 'name',
      header: 'Service',
      render: (s) => (
        <div>
          <p className="font-medium">{s.name}</p>
          {s.category && <p className="text-xs text-muted">{s.category}</p>}
        </div>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (s) => (s.durationMinutes ? `${s.durationMinutes} min` : <span className="text-muted">Branch default</span>),
    },
    { key: 'price', header: 'Price', render: (s) => formatMoney(s.price) },
    { key: 'branches', header: 'Offered at', render: (s) => branchLabel(s.branchIds, branches) },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
  ];

  const comboColumns = [
    { key: 'name', header: 'Combo', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'services', header: 'Services', render: (c) => c.serviceIds.map((s) => s.name).join(' + ') },
    {
      key: 'price',
      header: 'Price',
      render: (c) => (
        <div>
          <p>{formatMoney(c.comboPrice)}</p>
          <p className="text-xs text-muted line-through">{formatMoney(c.serviceIds.reduce((sum, s) => sum + s.price, 0))}</p>
        </div>
      ),
    },
    { key: 'branches', header: 'Offered at', render: (c) => branchLabel(c.branchIds, branches) },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
  ];

  const query = tab === 'services' ? servicesQuery : combosQuery;
  const activeServices = (servicesQuery.data ?? []).filter((s) => s.status === 'active');

  return (
    <>
      <PageHeader
        title="Services & combos"
        subtitle={canEdit ? 'What your salon offers, and at which branches' : 'Only the main owner can change these'}
        actions={
          canEdit && (
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} /> {tab === 'services' ? 'Add service' : 'Add combo'}
            </Button>
          )
        }
      />
      <Tabs tabs={TABS} value={tab} onChange={(value) => setSearchParams({ tab: value })} />

      {query.isError ? (
        <p className="text-sm text-danger">{query.error.message}</p>
      ) : (
        <Table
          columns={tab === 'services' ? serviceColumns : comboColumns}
          rows={query.data}
          loading={query.isPending}
          onRowClick={canEdit ? (row) => setEditing(row) : undefined}
          empty={
            tab === 'services' ? (
              <EmptyState icon={Scissors} title="No services yet" message="Add what your salon offers, like Haircut or Facial." />
            ) : (
              <EmptyState icon={Package} title="No combos yet" message="Bundle 2 or more services at a special price." />
            )
          }
        />
      )}

      {editing && tab === 'services' && (
        <ServiceFormModal service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {editing && tab === 'combos' && (
        <ComboFormModal combo={editing === 'new' ? null : editing} services={activeServices} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
