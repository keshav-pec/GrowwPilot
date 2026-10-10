import { useState } from 'react';
import { History } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useActivity } from '../../api/payroll';
import { formatDateTime } from '../../lib/time';
import { EmptyState, Pagination, Spinner } from '../../components/ui';

// Every pay change: who, when, what. Owners only; branch owners see their own branches.
export default function ActivityTab() {
  const { user, activeBranch } = useAuth();
  const [page, setPage] = useState(1);
  const activityQuery = useActivity(page);

  if (activityQuery.isPending) return <Spinner size={24} />;
  if (activityQuery.isError) return <p className="text-sm text-danger">{activityQuery.error.message}</p>;

  const { items, pages } = activityQuery.data;
  if (items.length === 0) {
    return <EmptyState icon={History} title="No activity yet" message="Every pay change and request will be listed here, with who did it and when." />;
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {items.map((item) => (
          <li key={item._id} className="px-4 py-3 text-sm">
            <p className="text-ink">{item.summary}</p>
            <p className="mt-1 text-xs text-muted">
              {item.actorName} · {item.actorRole}
              {user.branches.length > 1 && item.branchId?.name && ` · ${item.branchId.name}`} · {formatDateTime(item.createdAt, activeBranch?.timezone)}
            </p>
          </li>
        ))}
      </ul>
      <Pagination page={page} pages={pages} onChange={setPage} />
    </>
  );
}
