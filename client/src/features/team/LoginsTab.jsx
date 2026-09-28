import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useUsers } from '../../api/users';
import { Button, EmptyState, Table } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import CredentialsModal from '../../components/CredentialsModal';
import UserFormModal from './UserFormModal';

const columns = [
  { key: 'name', header: 'Name', render: (u) => <span className="font-medium">{u.name}</span> },
  { key: 'email', header: 'Email (login)' },
  { key: 'phone', header: 'Phone', render: (u) => u.phone || '—' },
  { key: 'branches', header: 'Branches', render: (u) => u.branchIds.map((b) => b.name).join(', ') },
  { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
];

// People who log in: front desk accounts (for the selected branch) or branch owners
export default function LoginsTab({ role }) {
  const { activeBranchId } = useAuth();
  const usersQuery = useUsers();
  const [editing, setEditing] = useState(null); // null | 'new' | user object
  const [credentials, setCredentials] = useState(null); // shown once after create / reset

  const rows = (usersQuery.data ?? []).filter(
    (u) => u.role === role && (role === 'OWNER' || u.branchIds[0]?._id === activeBranchId)
  );

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} /> {role === 'OWNER' ? 'Add branch owner' : 'Add front desk'}
        </Button>
      </div>

      {usersQuery.isError ? (
        <p className="text-sm text-danger">{usersQuery.error.message}</p>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          loading={usersQuery.isPending}
          onRowClick={(u) => setEditing(u)}
          empty={
            <EmptyState
              icon={KeyRound}
              title={role === 'OWNER' ? 'No branch owners yet' : 'No front desk logins for this branch'}
              message={
                role === 'OWNER'
                  ? 'A branch owner can manage staff and front desk accounts for the branches you choose.'
                  : 'Add a login for the receptionist who works at this branch.'
              }
            />
          }
        />
      )}

      {editing && (
        <UserFormModal
          role={role}
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onCredentials={setCredentials}
        />
      )}
      <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
    </>
  );
}
