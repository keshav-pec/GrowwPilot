import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, OctagonAlert, RefreshCw } from 'lucide-react';
import { useDashboard } from '../../api/dashboard';
import { formatMoney } from '../../lib/money';
import { formatTime } from '../../lib/time';
import { Card, EmptyState, HEADLINE_TILE, PageHeader, PageSpinner, StatTile } from '../../components/ui';

function RequiresAttention({ items }) {
  return (
    <Card title={`Requires attention${items.length ? ` (${items.length})` : ''}`}>
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All clear" message="No late appointments or unpaid visits." />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-3">
              {item.severity === 'high' ? (
                <OctagonAlert size={18} className="shrink-0 text-danger" aria-label="Urgent" />
              ) : (
                <AlertTriangle size={18} className="shrink-0 text-orange" aria-label="Soon" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted">{item.detail}</p>
              </div>
              <Link to={item.action.to} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface">
                {item.action.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// The owner's question: "Is my salon doing fine, and what needs my attention?"
export default function DashboardPage() {
  const dashboardQuery = useDashboard();

  if (dashboardQuery.isPending) return <PageSpinner />;
  if (dashboardQuery.isError) return <EmptyState title="Couldn’t load the dashboard" message={dashboardQuery.error.message} />;

  const { branch, kpis, attention, generatedAt } = dashboardQuery.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <span className="inline-flex items-center gap-1">
            {branch.name} · updated {formatTime(generatedAt, branch.timezone)}
            <RefreshCw size={12} className={dashboardQuery.isFetching ? 'animate-spin' : ''} aria-hidden />
          </span>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <StatTile {...HEADLINE_TILE} label="Net sales today" value={formatMoney(kpis.todayRevenue)} hint={`Collected ${formatMoney(kpis.todayCollected)} · without GST`} />
        <StatTile {...HEADLINE_TILE} label="Appointments today" value={kpis.todayAppointments} />
      </div>

      <RequiresAttention items={attention.filter((item) => item.kind !== 'FOLLOW_UP')} />
    </>
  );
}
