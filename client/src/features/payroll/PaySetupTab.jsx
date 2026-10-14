import { Users } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useStaffPayList } from '../../api/payroll';
import { describePay, formatPayDay, modelLabel } from '../../lib/payroll';
import { formatAmount } from '../../lib/money';
import { Badge, EmptyState, Table } from '../../components/ui';
import GroupSwitch, { groupOf } from './GroupSwitch';

// Everyone at the selected branch and how they're paid. Clicking a row opens their pay drawer.
// Owners switch between Staff and Front desk; the front desk only gets staff from the server.
export default function PaySetupTab({ group, onGroupChange, onOpenStaff }) {
  const { user } = useAuth();
  const isOwner = user.role === 'OWNER';
  const isFrontDeskGroup = group === 'front-desk';
  const listQuery = useStaffPayList();
  const allRows = (listQuery.data?.rows ?? []).map((r) => ({ ...r, key: r.staff._id }));
  const counts = { staff: 0, 'front-desk': 0 };
  for (const r of allRows) counts[groupOf(r.staff.kind)] += 1;
  const rows = allRows.filter((r) => groupOf(r.staff.kind) === group);
  const notSetUp = rows.filter((r) => !r.current && !r.upcoming && r.staff.status === 'active').length;

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <div>
          <span className="font-medium">{r.staff.name}</span>
          <span className="ml-2 text-xs text-muted">{r.staff.role}</span>
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
    ...(isOwner && !isFrontDeskGroup
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
      {isOwner && (
        <div className="mb-4">
          <GroupSwitch value={group} onChange={onGroupChange} counts={counts} />
        </div>
      )}
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
        empty={
          isFrontDeskGroup ? (
            <EmptyState icon={Users} title="No front desk members at this branch" message="In Team, add them with the type “Front desk”, then set their salary here." />
          ) : (
            <EmptyState icon={Users} title="No staff at this branch" message="Add stylists in Team first, then set how they’re paid here." />
          )
        }
      />
    </>
  );
}
