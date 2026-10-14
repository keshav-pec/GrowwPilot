import { Users } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useStaffPayList } from '../../api/payroll';
import { describePay, formatPayDay, modelLabel } from '../../lib/payroll';
import { formatAmount } from '../../lib/money';
import { Badge, EmptyState, Table } from '../../components/ui';

// Everyone at the selected branch and how they're paid. Clicking a row opens their pay drawer.
export default function PaySetupTab({ onOpenStaff }) {
  const { user } = useAuth();
  const listQuery = useStaffPayList();
  const rows = (listQuery.data?.rows ?? []).map((r) => ({ ...r, key: r.staff._id }));
  const notSetUp = rows.filter((r) => !r.current && !r.upcoming && r.staff.status === 'active').length;

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <div>
          <span className="font-medium">{r.staff.name}</span>
          <span className="ml-2 text-xs text-muted">{r.staff.role}</span>
          {r.staff.kind === 'FRONT_DESK' && (
            <span className="ml-2">
              <Badge tone="brown">Front desk</Badge>
            </span>
          )}
          {r.staff.status !== 'active' && <span className="ml-2 text-xs text-muted">(inactive)</span>}
        </div>
      ),
    },
    {
      key: 'pay',
      header: 'How they’re paid',
      render: (r) =>
        r.current ? (
          <div>
            <span>{describePay(r.current)}</span>
            <span className="block text-xs text-muted">{modelLabel(r.current.model)}</span>
          </div>
        ) : (
          <Badge tone="orange">Not set up</Badge>
        ),
    },
    { key: 'since', header: 'Since', render: (r) => (r.current ? formatPayDay(r.current.effectiveFrom) : '—') },
    // Owners only: the server doesn't send it to the front desk
    ...(user.role === 'OWNER'
      ? [{ key: 'commission', header: 'Commission this month', render: (r) => (r.commissionThisMonth ? formatAmount(r.commissionThisMonth) : '—') }]
      : []),
    {
      key: 'next',
      header: 'Coming up',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.upcoming && <Badge tone="gold">Changes {formatPayDay(r.upcoming.effectiveFrom)}</Badge>}
          {r.pendingRequest && <Badge tone="yellow">Request waiting</Badge>}
          {!r.upcoming && !r.pendingRequest && <span className="text-muted">—</span>}
        </div>
      ),
    },
  ];

  if (listQuery.isError) return <p className="text-sm text-danger">{listQuery.error.message}</p>;

  return (
    <>
      {notSetUp > 0 && (
        <p className="mb-4 rounded-lg bg-yellow-soft px-4 py-3 text-sm text-ink">
          {notSetUp === 1 ? '1 person doesn’t' : `${notSetUp} people don’t`} have a pay setup yet. Click a name to{' '}
          {user.role === 'OWNER' ? 'choose how they’re paid.' : 'ask an owner to set it up.'}
        </p>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey="key"
        loading={listQuery.isPending}
        onRowClick={(r) => onOpenStaff(r.staff._id)}
        empty={<EmptyState icon={Users} title="No staff at this branch" message="Add stylists in Team first, then set how they’re paid here." />}
      />
    </>
  );
}
