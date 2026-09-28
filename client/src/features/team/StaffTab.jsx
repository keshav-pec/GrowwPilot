import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { useStaff } from '../../api/staff';
import { Button, EmptyState, Table } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import StaffFormModal from './StaffFormModal';

const columns = [
  { key: 'name', header: 'Name', render: (s) => <span className="font-medium">{s.name}</span> },
  { key: 'role', header: 'Role' },
  { key: 'phone', header: 'Phone', render: (s) => s.phone || '—' },
  { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
];

// Stylists and beauticians of the branch picked in the branch switcher
export default function StaffTab() {
  const staffQuery = useStaff();
  const [editing, setEditing] = useState(null); // null | 'new' | staff object
  const [showArchived, setShowArchived] = useState(false);

  const rows = (staffQuery.data ?? []).filter((s) => showArchived || s.status !== 'archived');

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-gold" />
          Show archived
        </label>
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
          empty={<EmptyState icon={Users} title="No staff yet" message="Add the stylists who work at this branch." />}
        />
      )}

      {editing && <StaffFormModal staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
