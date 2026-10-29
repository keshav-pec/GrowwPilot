import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { ArrowLeft, Download } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { downloadOccasionReport, useOccasionReport } from '../../../api/occasions';
import { formatMoney } from '../../../lib/money';
import { CHANNEL_LABEL, MONTHS } from '../../../lib/occasions';
import { Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Table } from '../../../components/ui';

// This month and the 12 before it
function monthOptions(zone) {
  const now = DateTime.now().setZone(zone);
  return Array.from({ length: 13 }, (_, i) => {
    const d = now.minus({ months: i });
    return { value: d.toFormat('yyyy-MM'), label: `${MONTHS[d.month - 1]} ${d.year}` };
  });
}

// Reports → Occasion offers (owners; a branch owner sees their branches): offers issued, contacted, linked bookings
// and used, the steps from eligible to used, discounts and associated sales, by branch and by staff, with CSV.
export default function OccasionReportsPage() {
  const { user, activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const [mode, setMode] = useState('month'); // 'month' or 'dates'
  const [filters, setFilters] = useState({ month: DateTime.now().setZone(zone).toFormat('yyyy-MM'), from: '', to: '', type: '', campaignId: '', campaignVersionId: '', branch: 'all', channel: '', canMessage: '' });
  const [downloading, setDownloading] = useState(false);
  const params = { ...filters, month: mode === 'month' ? filters.month : '', from: mode === 'dates' ? filters.from : '', to: mode === 'dates' ? filters.to : '' };
  const reportQuery = useOccasionReport(params);
  const set = (field) => (e) => setFilters((f) => ({ ...f, [field]: e.target.value, ...(field === 'campaignId' ? { campaignVersionId: '' } : {}) }));
  const r = reportQuery.data;
  const campaign = r?.campaigns.find((c) => c._id === filters.campaignId);

  async function download() {
    setDownloading(true);
    try {
      await downloadOccasionReport(params);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const branchColumns = [
    { key: 'branch', header: 'Branch' },
    { key: 'issued', header: 'Offers issued' },
    { key: 'contacted', header: 'Contacted' },
    { key: 'booked', header: 'Booked' },
    { key: 'used', header: 'Used' },
    { key: 'discounts', header: 'Discounts given', render: (b) => formatMoney(b.discounts) },
    { key: 'associatedSales', header: 'Associated sales', render: (b) => formatMoney(b.associatedSales) },
  ];
  const staffColumns = [
    { key: 'name', header: 'Staff' },
    { key: 'messages', header: 'Messages sent' },
    { key: 'calls', header: 'Calls recorded' },
    { key: 'reached', header: 'Reached' },
    { key: 'linkedBookings', header: 'Linked bookings' },
    { key: 'uses', header: 'Offers applied on bills' },
  ];

  return (
    <>
      <Link to="/app/occasions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Customer occasions
      </Link>
      <PageHeader
        title="Occasion offer reports"
        subtitle={r ? `${r.period.label} · ${r.branches.length === 1 ? r.branches[0] : 'all my branches'}` : ''}
        actions={
          <Button variant="secondary" onClick={download} loading={downloading}>
            <Download size={16} /> Download CSV
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select aria-label="Period" value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'month', label: 'A month' }, { value: 'dates', label: 'Dates' }]} />
          {mode === 'month' ? (
            <Select aria-label="Month" value={filters.month} onChange={set('month')} options={monthOptions(zone)} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label="From" type="date" value={filters.from} onChange={set('from')} />
              <Input aria-label="To" type="date" value={filters.to} onChange={set('to')} />
            </div>
          )}
          <Select aria-label="Occasion" placeholder="Both occasions" value={filters.type} onChange={set('type')} options={[{ value: 'BIRTHDAY', label: 'Birthday' }, { value: 'ANNIVERSARY', label: 'Anniversary' }]} />
          <Select aria-label="Campaign" placeholder="All campaigns" value={filters.campaignId} onChange={set('campaignId')} options={(r?.campaigns ?? []).map((c) => ({ value: c._id, label: c.name }))} />
          {campaign && campaign.versions.length > 1 && (
            <Select aria-label="Version" placeholder="All versions" value={filters.campaignVersionId} onChange={set('campaignVersionId')} options={campaign.versions.map((v) => ({ value: v._id, label: `Version ${v.version}` }))} />
          )}
          {user.branches.length > 1 && (
            <Select aria-label="Branch" value={filters.branch} onChange={set('branch')} options={[{ value: 'all', label: 'All my branches' }, ...user.branches.map((b) => ({ value: b._id, label: b.name }))]} />
          )}
          <Select aria-label="Channel" placeholder="Any channel" value={filters.channel} onChange={set('channel')} options={Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label: `Sent by ${label}` }))} />
          <Select aria-label="Can be messaged" placeholder="Messaging: any" value={filters.canMessage} onChange={set('canMessage')} options={[{ value: 'yes', label: 'Can be messaged' }, { value: 'no', label: 'In-salon only' }]} />
        </div>
      </Card>

      {reportQuery.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner size={28} />
        </div>
      ) : reportQuery.isError ? (
        <EmptyState title="Couldn’t load the report" message={reportQuery.error.message} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Offers issued" value={r.tiles.issued} />
            <Tile label="Customers contacted" value={r.tiles.customersContacted} />
            <Tile label="Offer-linked appointments" value={r.tiles.linkedBookings} />
            <Tile label="Redeemed offers" value={r.tiles.used} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Customer progression">
              <ul className="flex flex-col gap-3">
                {r.funnel.map((s) => (
                  <li key={s.step}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{s.step}</span>
                      <span className="font-medium">{s.count}</span>
                    </div>
                    <div className="h-3 rounded-full bg-surface" role="img" aria-label={`${s.step}: ${s.count}`}>
                      <div className="h-3 rounded-full bg-gold" style={{ width: `${r.funnel[0].count ? Math.round((s.count / r.funnel[0].count) * 100) : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Counts by step; not a profit claim.</p>
            </Card>
            <Card title="Discount & billing">
              <dl className="grid grid-cols-2 gap-4">
                <Money label="Associated sales" value={formatMoney(r.money.associatedSales)} hint="Bills that used an offer, after refunds" />
                <Money label="Discounts given" value={formatMoney(r.money.discounts)} hint="Offer discounts on issued bills" />
                <Money label="Used / issued" value={`${r.money.usedPercent}%`} />
                <Money label="Period" value={r.period.label} />
              </dl>
              <p className="mt-3 text-xs text-muted">Associated sales are bills where an offer was used. The customer might have come anyway, so this isn’t a return on the offer.</p>
            </Card>
          </div>

          <Card title="By branch">
            <Table columns={branchColumns} rows={r.byBranch} rowKey="branchId" />
          </Card>
          <Card title="Staff activity">
            <Table columns={staffColumns} rows={r.staff} rowKey="userId" empty={<EmptyState title="No follow-up recorded yet" />} />
            <p className="mt-2 text-xs text-muted">What each person did on these offers. Sales are not credited to individuals.</p>
          </Card>
        </div>
      )}
    </>
  );
}

function Tile({ label, value }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold text-brown">{value}</p>
    </div>
  );
}

function Money({ label, value, hint }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold text-brown">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}
