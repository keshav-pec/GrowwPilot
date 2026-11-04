import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleAlert, CircleCheck, CircleDashed, OctagonAlert, RefreshCw } from 'lucide-react';
import { useDashboard } from '../../api/dashboard';
import { formatMoney } from '../../lib/money';
import { formatTime } from '../../lib/time';
import { Card, EmptyState, HEADLINE_TILE, PageHeader, PageSpinner, StatTile } from '../../components/ui';

// Each status always has an icon AND a label, so colour is never the only signal
const SIGNAL = {
  good: { icon: CircleCheck, color: 'text-good', label: 'Good' },
  watch: { icon: CircleAlert, color: 'text-gold-dark', label: 'Watch' },
  action: { icon: OctagonAlert, color: 'text-danger', label: 'Act' },
  neutral: { icon: CircleDashed, color: 'text-muted', label: 'No data' },
};

function SalonPulse({ signals }) {
  return (
    <Card className="mb-4">
      <ul className="flex flex-col gap-2">
        {signals.map((signal) => {
          const s = SIGNAL[signal.status];
          const SignalIcon = s.icon;
          return (
            <li key={signal.key} className="flex items-start gap-2 text-sm">
              <SignalIcon size={18} className={`mt-0.5 shrink-0 ${s.color}`} aria-label={s.label} />
              <p>
                <span className="font-medium">{signal.label}:</span> <span className="text-muted">{signal.reason}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RequiresAttention({ items }) {
  return (
    <Card title={`Requires attention${items.length ? ` (${items.length})` : ''}`}>
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All clear" message="No late appointments, unpaid visits or overdue follow-ups." />
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

  const { branch, kpis, signals, attention, generatedAt } = dashboardQuery.data;

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

      <SalonPulse signals={signals} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile {...HEADLINE_TILE} label="Net sales today" value={formatMoney(kpis.todayRevenue)} hint={`Collected ${formatMoney(kpis.todayCollected)} · without GST`} />
        <StatTile {...HEADLINE_TILE} label="Appointments today" value={kpis.todayAppointments} />
        <StatTile {...HEADLINE_TILE} label="Open leads" value={kpis.openLeads} />
      </div>

      <RequiresAttention items={attention} />
    </>
  );
}
