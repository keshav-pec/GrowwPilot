import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useBranches, useSetBranchStatus } from '../../api/branches';
import { Button, ConfirmDialog, Modal, PageHeader, Table } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import BlockingBookings from '../../components/BlockingBookings';
import BranchFormModal from './BranchFormModal';

export default function BranchesPage() {
  const { user } = useAuth();
  const isPrimaryOwner = user.allBranches; // only the main owner can change branches
  const branchesQuery = useBranches();
  const setStatus = useSetBranchStatus();

  const [editing, setEditing] = useState(null); // null = closed, 'new' = add form, object = edit form
  const [archiving, setArchiving] = useState(null); // branch waiting for "Are you sure?"
  const [blocked, setBlocked] = useState(null); // { branch, bookings } when archive is refused

  function changeStatus(branch, status) {
    setStatus.mutate(
      { _id: branch._id, status },
      {
        onSuccess: () => toast.success(`${branch.name} ${status === 'archived' ? 'archived' : 'restored'}`),
        onError: (err) =>
          err.code === 'HAS_FUTURE_BOOKINGS' ? setBlocked({ branch, bookings: err.details }) : toast.error(err.message),
        onSettled: () => setArchiving(null),
      }
    );
  }

  const columns = [
    { key: 'name', header: 'Branch', render: (b) => <span className="font-medium">{b.name}</span> },
    { key: 'city', header: 'City' },
    { key: 'hours', header: 'Hours', render: (b) => `${b.openTime} – ${b.closeTime}` },
    { key: 'timezone', header: 'Timezone' },
    { key: 'defaultServiceMinutes', header: 'Default service', render: (b) => `${b.defaultServiceMinutes} min` },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
  ];

  if (isPrimaryOwner) {
    columns.push({
      key: 'actions',
      header: '',
      render: (b) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {b.status === 'active' ? (
            <Button size="sm" variant="ghost" onClick={() => setArchiving(b)}>
              Archive
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => changeStatus(b, 'active')}>
              Restore
            </Button>
          )}
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle={isPrimaryOwner ? 'Your salon’s locations' : 'The branches you manage'}
        actions={
          isPrimaryOwner && (
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} /> Add branch
            </Button>
          )
        }
      />

      {branchesQuery.isError ? (
        <p className="text-sm text-danger">{branchesQuery.error.message}</p>
      ) : (
        <Table
          columns={columns}
          rows={branchesQuery.data}
          loading={branchesQuery.isPending}
          onRowClick={isPrimaryOwner ? (branch) => setEditing(branch) : undefined}
        />
      )}

      {editing && <BranchFormModal branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={() => changeStatus(archiving, 'archived')}
        loading={setStatus.isPending}
        danger
        title={`Archive ${archiving?.name}?`}
        message="The branch disappears from the branch switcher and booking. Its history is kept and you can restore it later."
        confirmLabel="Archive"
      />

      <Modal
        open={Boolean(blocked)}
        onClose={() => setBlocked(null)}
        title={`Can’t archive ${blocked?.branch.name} yet`}
        footer={<Button onClick={() => setBlocked(null)}>OK</Button>}
      >
        <p className="text-sm text-muted">These upcoming bookings need to be moved or cancelled first:</p>
        {blocked && <BlockingBookings bookings={blocked.bookings} />}
      </Modal>
    </>
  );
}
