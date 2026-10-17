import { useState } from 'react';
import { DateTime } from 'luxon';
import { Download } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import toast from 'react-hot-toast';
import { downloadReportCsv, useReport } from '../../../api/inventory/reports';
import { formatQty } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { Button, EmptyState, Input, Select, Spinner } from '../../../components/ui';

// The reports (INV-14). Costs-only reports are hidden from people who can't see costs (the server refuses them too).
const REPORTS = [
  { value: 'stock-summary', label: 'Stock summary' },
  { value: 'low-stock', label: 'Low stock' },
  { value: 'use-by-product', label: 'Use by product' },
  { value: 'recipient-use', label: 'Station and stylist use' },
  { value: 'service-use', label: 'Service-linked use' },
  { value: 'waste', label: 'Waste and shrinkage' },
  { value: 'purchasing', label: 'Purchasing' },
  { value: 'price-changes', label: 'Price changes', costsOnly: true },
  { value: 'stock-value', label: 'Stock value', costsOnly: true },
  { value: 'bottle-efficiency', label: 'Bottle efficiency (approximate)' },
];

function show(column, row) {
  const value = row[column.key];
  if (value == null || value === '') return '—';
  if (column.qty) return formatQty(value, row._sku);
  if (column.money) return formatAmount(value);
  return value;
}

export default function ReportsTab({ can }) {
  const { user, activeBranch } = useAuth();
  const today = DateTime.now().setZone(activeBranch?.timezone).toISODate();
  const [name, setName] = useState('stock-summary');
  const [from, setFrom] = useState(DateTime.fromISO(today).minus({ days: 29 }).toISODate());
  const [to, setTo] = useState(today);
  const [branches, setBranches] = useState('current');
  const [downloading, setDownloading] = useState(false);
  const params = { from, to, branches };
  const reportQuery = useReport(name, params);
  const report = reportQuery.data;
  const reports = REPORTS.filter((r) => !r.costsOnly || can['inventory.viewCosts']);
  // Reports that show stock "now" don't use the dates
  const usesDates = !['stock-summary', 'low-stock', 'stock-value'].includes(name);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div className="lg:col-span-2">
          <Select label="Report" options={reports} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {usesDates && (
          <>
            <Input id="report-from" type="date" label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <Input id="report-to" type="date" label="To" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        {user.branches.length > 1 && (
          <Select
            label="Branches"
            options={[
              { value: 'current', label: activeBranch?.name ?? 'This branch' },
              { value: 'all', label: 'All my branches' },
            ]}
            value={branches}
            onChange={(e) => setBranches(e.target.value)}
          />
        )}
      </div>

      {reportQuery.isPending ? (
        <Spinner size={24} />
      ) : reportQuery.isError ? (
        <p className="text-sm text-danger">{reportQuery.error.message}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-brown">{report.title}</h2>
              <p className="text-xs text-muted">
                {report.branches.join(', ')}
                {usesDates && ` · ${DateTime.fromISO(report.from).toFormat('d LLL')} to ${DateTime.fromISO(report.to).toFormat('d LLL yyyy')}`}
              </p>
              {report.note && <p className="mt-1 text-xs text-muted">{report.note}</p>}
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={downloading}
              onClick={() => {
                setDownloading(true);
                downloadReportCsv(name, params)
                  .catch((err) => toast.error(err.message))
                  .finally(() => setDownloading(false));
              }}
            >
              <Download size={16} /> Download CSV
            </Button>
          </div>
          {report.rows.length === 0 ? (
            <EmptyState title="Nothing to show" message="There is nothing for these dates and branches." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-muted">
                  <tr>
                    {report.columns.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {report.columns.map((c) => (
                        <td key={c.key} className="whitespace-nowrap px-3 py-2">
                          {show(c, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
