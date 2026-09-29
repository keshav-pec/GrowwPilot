import { useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { Download } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { analyticsPdfUrl, useAnalytics } from '../../api/analytics';
import { formatMoney } from '../../lib/money';
import { todayIn } from '../../lib/time';
import { Card, EmptyState, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { HBarChart, SlotHeatmap } from './charts';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const METHOD = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
const rupees = (paise) => formatMoney(paise).replace(/\.00$/, '');
const pct = (value) => (value === null ? '—' : `${value}%`);

// A small numbers table next to each chart, so no value is only reachable by hovering
function DataTable({ columns, rows }) {
  if (rows.length === 0) return null;
  return (
    // overflow-x-auto: on a phone a wide table scrolls inside its card
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {columns.map((c) => (
              <th key={c.header} className={`whitespace-nowrap py-1.5 pr-2 font-medium ${c.right ? 'text-right' : ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {columns.map((c) => (
                <td key={c.header} className={`whitespace-nowrap py-1.5 pr-2 ${c.right ? 'text-right' : ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user, activeBranch } = useAuth();
  const today = todayIn(activeBranch.timezone);
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters live in the URL. Default: the last 30 days, all branches.
  const filters = {
    from: searchParams.get('from') || DateTime.fromISO(today).minus({ days: 29 }).toISODate(),
    to: searchParams.get('to') || today,
    branchId: searchParams.get('branchId') || 'all',
  };
  const setFilters = (changes) => setSearchParams({ ...filters, ...changes });

  const presets = [
    { label: 'Last 7 days', from: DateTime.fromISO(today).minus({ days: 6 }).toISODate(), to: today },
    { label: 'Last 30 days', from: DateTime.fromISO(today).minus({ days: 29 }).toISODate(), to: today },
    { label: 'This month', from: DateTime.fromISO(today).startOf('month').toISODate(), to: today },
  ];

  const analyticsQuery = useAnalytics(filters);
  const data = analyticsQuery.data;
  const busiest = data ? [...data.slotDemand.slots].filter((s) => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 3) : [];

  return (
    <>
      <PageHeader title="Analytics" subtitle="Which branches, times, stylists and services are most in demand" />

      {/* One filter row for the whole page */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setFilters({ from: p.from, to: p.to })}
              className={`rounded-full border px-3 py-1.5 text-sm ${filters.from === p.from && filters.to === p.to ? 'border-gold bg-gold font-medium text-ink' : 'border-border text-muted hover:text-ink'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Input type="date" aria-label="From" value={filters.from} max={filters.to} onChange={(e) => e.target.value && setFilters({ from: e.target.value })} className="w-40" />
        <span className="pb-2 text-sm text-muted">to</span>
        <Input type="date" aria-label="To" value={filters.to} min={filters.from} onChange={(e) => e.target.value && setFilters({ to: e.target.value })} className="w-40" />
        <div className="w-44">
          <Select
            aria-label="Branch"
            options={[{ value: 'all', label: 'All branches' }, ...user.branches.map((b) => ({ value: b._id, label: b.name }))]}
            value={filters.branchId}
            onChange={(e) => setFilters({ branchId: e.target.value })}
          />
        </div>
        <a
          href={analyticsPdfUrl(filters)}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-dark"
        >
          <Download size={16} /> Export PDF
        </a>
      </div>

      {analyticsQuery.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner size={28} />
        </div>
      ) : analyticsQuery.isError ? (
        <EmptyState title="Couldn’t load analytics" message={analyticsQuery.error.message} />
      ) : (
        // While new filters load, keep the old charts (dimmed) instead of flashing a spinner
        <div className={`flex flex-col gap-4 transition-opacity ${analyticsQuery.isPlaceholderData ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Revenue" value={rupees(data.totals.revenue)} />
            <StatTile label="Bookings" value={data.totals.bookings} />
            <StatTile label="Invoices" value={data.totals.invoices} />
            <StatTile label="Average ticket" value={rupees(data.totals.avgTicket)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Branch demand" className="min-w-0">
              {/* One branch = one bar, which is just a number: show the table only */}
              {data.branchDemand.length > 1 && <HBarChart data={data.branchDemand} valueKey="bookings" label="Bookings" />}
              <DataTable
                rows={data.branchDemand}
                columns={[
                  { header: 'Branch', render: (b) => b.name },
                  { header: 'Bookings', right: true, render: (b) => b.bookings },
                  { header: 'Revenue', right: true, render: (b) => rupees(b.revenue) },
                  { header: 'Avg ticket', right: true, render: (b) => rupees(b.avgTicket) },
                ]}
              />
            </Card>

            <Card title="Busiest times (branch time)" className="min-w-0">
              <SlotHeatmap hours={data.slotDemand.hours} slots={data.slotDemand.slots} />
              {busiest.length > 0 && (
                <p className="mt-2 text-sm text-muted">
                  Busiest: {busiest.map((s) => `${DAY_NAMES[s.day]} ${DateTime.fromObject({ hour: s.hour }).toFormat('h a')} (${s.count})`).join(', ')}
                </p>
              )}
            </Card>

            <Card title="Stylist demand" className="min-w-0">
              <HBarChart data={data.stylistDemand} valueKey="bookings" label="Bookings" />
              <DataTable
                rows={data.stylistDemand}
                columns={[
                  { header: 'Stylist', render: (s) => s.name },
                  { header: 'Bookings', right: true, render: (s) => s.bookings },
                  { header: 'Booked hrs', right: true, render: (s) => (s.bookedMinutes / 60).toFixed(1) },
                  { header: 'Utilisation', right: true, render: (s) => pct(s.utilisation) },
                  { header: 'Service value', right: true, render: (s) => rupees(s.serviceValue) },
                ]}
              />
            </Card>

            <Card title="Top services" className="min-w-0">
              <HBarChart data={data.serviceDemand.slice(0, 8)} valueKey="bookings" label="Bookings" />
              <DataTable
                rows={data.serviceDemand.slice(0, 8)}
                columns={[
                  { header: 'Service', render: (s) => s.name },
                  { header: 'Bookings', right: true, render: (s) => s.bookings },
                  { header: 'Service value', right: true, render: (s) => rupees(s.serviceValue) },
                ]}
              />
            </Card>

            <Card title="Lead sources" className="min-w-0">
              <HBarChart data={data.leadSources.map((l) => ({ ...l, name: l.source }))} valueKey="leads" label="Leads" />
              <DataTable
                rows={data.leadSources}
                columns={[
                  { header: 'Source', render: (l) => l.source },
                  { header: 'Leads', right: true, render: (l) => l.leads },
                  { header: 'Booked', right: true, render: (l) => l.converted },
                  { header: 'Conversion', right: true, render: (l) => pct(l.rate) },
                ]}
              />
            </Card>

            <Card title="Payment mix" className="min-w-0">
              <HBarChart data={data.paymentMix.map((m) => ({ ...m, name: METHOD[m.method] }))} valueKey="amount" label="Amount" format={rupees} />
              <DataTable
                rows={data.paymentMix}
                columns={[
                  { header: 'Method', render: (m) => METHOD[m.method] },
                  { header: 'Payments', right: true, render: (m) => m.payments },
                  { header: 'Amount', right: true, render: (m) => rupees(m.amount) },
                  { header: 'Share', right: true, render: (m) => pct(m.share) },
                ]}
              />
            </Card>
          </div>

          <p className="text-xs text-muted">
            Revenue = invoices paid in the period. Service value = list price of completed services (before discounts and combo prices).
          </p>
        </div>
      )}
    </>
  );
}
