import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { downloadBillingCsv, useBillingReport, useBillingReportList } from '../../api/billingReports';
import { formatMoney } from '../../lib/money';
import { todayIn, addDays } from '../../lib/time';
import { Button, Card, EmptyState, Input, PageHeader, PageSpinner, Select } from '../../components/ui';
import ReportTable from '../../components/ReportTable';

// Billing reports with CSV download. Owners: every report for this branch or all their branches.
// Front desk: today's collections at their branch only.
export default function BillingReportsPage() {
  const { user, activeBranch } = useAuth();
  const owner = user.role === 'OWNER';
  const list = useBillingReportList();
  const today = todayIn(activeBranch.timezone);
  const [name, setName] = useState(owner ? 'sales' : 'collections');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [branches, setBranches] = useState('current');
  const [downloading, setDownloading] = useState(false);

  const params = owner ? { from, to, branches } : {};
  const report = useBillingReport(name, params, Boolean(from && to));
  const options = (list.data ?? []).filter((r) => owner || r.name === 'collections').map((r) => ({ value: r.name, label: r.label }));

  async function download() {
    setDownloading(true);
    try {
      await downloadBillingCsv(name, params);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const data = report.data;
  const cell = (column, value) => (value == null ? '—' : column.money ? formatMoney(value) : value);

  return (
    <>
      <PageHeader
        title="Billing reports"
        subtitle={owner ? 'Sales, GST, collections, dues and more. Download any of them as CSV.' : 'Today’s collections at your branch'}
        actions={
          <>
            {owner && user.org?.occasionOffers?.enabled && (
              <Link to="/app/occasions/reports" className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface">
                Occasion offers report
              </Link>
            )}
            <Button variant="secondary" onClick={download} loading={downloading} disabled={!data}>
              <Download size={16} /> Download CSV
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select aria-label="Report" options={options} value={name} onChange={(e) => setName(e.target.value)} />
        {owner && name !== 'dues' && (
          <>
            <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        {owner && user.branches.length > 1 && (
          <Select aria-label="Branches" options={[{ value: 'current', label: 'This branch' }, { value: 'all', label: 'All my branches' }]} value={branches} onChange={(e) => setBranches(e.target.value)} />
        )}
      </div>

      {report.isPending ? (
        <PageSpinner />
      ) : report.isError ? (
        <EmptyState title="Couldn’t run the report" message={report.error.message} />
      ) : (
        <Card title={data.title} className={report.isPlaceholderData ? 'opacity-60' : ''}>
          {data.note && <p className="mb-3 text-sm text-muted">{data.note}</p>}
          {data.rows.length === 0 ? (
            <EmptyState title="Nothing in this period" />
          ) : (
            <ReportTable columns={data.columns} rows={data.rows} totals={data.totals} cell={(c, row) => cell(c, row[c.key])} />
          )}
        </Card>
      )}
    </>
  );
}
