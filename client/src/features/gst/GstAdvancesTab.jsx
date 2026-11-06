import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import { downloadGstAdvances, useGstAdvances, useGstOverview } from '../../api/gst';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { Button, Card, EmptyState, Select, SummaryRow, Table } from '../../components/ui';

// Advances for named services: taken, used and left, with their tax, for each GSTIN. A row opens its receipt voucher.
export default function GstAdvancesTab() {
  const navigate = useNavigate();
  const [gstin, setGstin] = useState('');
  const [open, setOpen] = useState('');
  const params = { gstin: gstin || undefined, open: open || undefined };
  const view = useGstAdvances(params);
  const gstins = useGstOverview({}).data?.gstins ?? [];
  const data = view.data;

  const columns = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    {
      key: 'receiptNumber',
      header: 'Voucher',
      render: (r) => (
        <div>
          <p className="font-mono text-xs">{r.receiptNumber}</p>
          <p className="text-xs text-muted">{r.branch}{r.reversed ? ' · reversed' : ''}</p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (r) => (
        <div>
          <p>{r.customer}</p>
          <p className="text-xs text-muted">{r.services}</p>
        </div>
      ),
    },
    { key: 'taken', header: 'Taken', render: (r) => formatMoney(r.taken) },
    { key: 'used', header: 'Used', render: (r) => formatMoney(r.used) },
    { key: 'givenBack', header: 'Given back', render: (r) => formatMoney(r.givenBack) },
    { key: 'left', header: 'Left', render: (r) => <span className="font-medium">{formatMoney(r.left)}</span> },
    { key: 'taxTaken', header: 'Tax paid', render: (r) => formatMoney(r.taxTaken) },
    { key: 'taxLeft', header: 'Tax left', render: (r) => formatMoney(r.taxLeft) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-64">
          <Select label="GSTIN" options={[{ value: '', label: 'All GSTINs' }, ...gstins.map((g) => ({ value: g.gstin, label: g.gstin }))]} value={gstin} onChange={(e) => setGstin(e.target.value)} />
        </div>
        <Select label="Show" options={[{ value: '', label: 'All advances' }, { value: 'true', label: 'With money left' }]} value={open} onChange={(e) => setOpen(e.target.value)} />
        <Button variant="secondary" disabled={!data?.rows?.length} onClick={() => downloadGstAdvances(params).catch((err) => toast.error(err.message))}>
          <Download size={16} /> CSV
        </Button>
      </div>

      {view.isError ? (
        <EmptyState title="Couldn’t load advances" message={view.error.message} />
      ) : (
        <Table columns={columns} rows={data?.rows} loading={view.isPending} onRowClick={(r) => navigate(r.link)} empty={<EmptyState title="No advances for named services" message="Take one on a customer’s profile. Its tax is worked out when the money comes in." />} />
      )}

      {data?.byGstin?.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.byGstin.map((g) => (
            <Card key={g.gstin} title={<span className="font-mono text-sm">{g.gstin}</span>}>
              <dl className="flex flex-col gap-1 text-sm">
                <SummaryRow label="Taken" value={formatMoney(g.taken)} />
                <SummaryRow label="Used on bills" value={formatMoney(g.used)} />
                <SummaryRow label="Given back" value={formatMoney(g.givenBack)} />
                <SummaryRow label="Left" value={formatMoney(g.left)} />
                <SummaryRow label="Tax paid" value={formatMoney(g.taxTaken)} muted />
                <SummaryRow label="Tax used or given back" value={formatMoney(g.taxUsed)} muted />
                <SummaryRow label="Tax left" value={formatMoney(g.taxLeft)} muted />
              </dl>
            </Card>
          ))}
        </div>
      )}
      {data?.plainLeft > 0 && <p className="text-xs text-muted">Plain advances and extra money kept at checkout aren’t taxed when received. {formatMoney(data.plainLeft)} of those is left to use.</p>}
    </div>
  );
}
