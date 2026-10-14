import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { useStaff } from '../../api/staff';
import { Badge, Button, EmptyState, Select, Table } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import StaffFormModal from './StaffFormModal';

const columns = [
  { key: 'name', header: 'Name', render: (s) => <span className="font-medium">{s.name}</span> },
  {
    key: 'kind',
    header: 'Type',
    render: (s) => (s.kind === 'FRONT_DESK' ? <Badge tone="brown">Front desk</Badge> : <Badge tone="gold">Service staff</Badge>),
  },
  { key: 'role', header: 'Job title' },
  { key: 'phone', header: 'Phone', render: (s) => s.phone || '—' },
  { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
];

const TYPE_FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'SERVICE', label: 'Service staff' },
  { value: 'FRONT_DESK', label: 'Front desk' },
];

// Stylists, beauticians and front desk members of the branch picked in the branch switcher
export default function StaffTab() {
  const staffQuery = useStaff();
  const [editing, setEditing] = useState(null); // null | 'new' | staff object
  const [showArchived, setShowArchived] = useState(false);
  const [type, setType] = useState('all');

  const rows = (staffQuery.data ?? []).filter(
    (s) => (showArchived || s.status !== 'archived') && (type === 'all' || (s.kind ?? 'SERVICE') === type)
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <Select aria-label="Type" options={TYPE_FILTERS} value={type} onChange={(e) => setType(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-gold" />
            Show archived
          </label>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} /> Add staff
        </Button>
      </div>

      {staffQuery.isError ? (
        <p className="text-sm text-danger">{staffQuery.error.message}</p>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          loading={staffQuery.isPending}
          onRowClick={(staff) => setEditing(staff)}
          empty={<EmptyState icon={Users} title="No staff yet" message="Add the stylists and front desk people who work at this branch." />}
        />
      )}

      {editing && <StaffFormModal staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
