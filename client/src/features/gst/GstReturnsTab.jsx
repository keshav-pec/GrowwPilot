import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { refusalText, useGstReturns, usePrepareReturn } from '../../api/gst';
import { formatMoney } from '../../lib/money';
import { formatMonth } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Badge, Button, EmptyState, PageSpinner, Select, Table } from '../../components/ui';
import { RETURN_STATUS } from './returnStatus';

// GSTR-1: each month of a GSTIN and where its return stands. Returns are per GSTIN, not per branch.
export default function GstReturnsTab() {
  const navigate = useNavigate();
  const [gstin, setGstin] = useState('');
  const query = useGstReturns({ gstin: gstin || undefined });
  const prepare = usePrepareReturn();
  if (query.isPending) return <PageSpinner />;
  if (query.isError) return <EmptyState title="Couldn’t load returns" message={query.error.message} />;
  const data = query.data;
  if (!data.active) return <EmptyState title="GST setup isn’t active" message="Returns come from your tax record, which begins when you activate GST setup." />;

  function start(month) {
    prepare.mutate(
      { key: newRequestKey(), gstin: data.gstin, period: month.period },
      {
        onSuccess: ({ returnId }) => navigate(`/app/gst/returns/${returnId}`),
        onError: (err) => toast.error(refusalText(err)),
      }
    );
  }

  const columns = [
    { key: 'period', header: 'Month', render: (m) => <span className="font-medium">{formatMonth(m.period)}</span> },
    {
      key: 'status',
      header: 'GSTR-1',
      render: (m) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={RETURN_STATUS[m.status].tone}>{RETURN_STATUS[m.status].label}</Badge>
          {m.revision && <span className="text-xs text-muted">Revision {m.revision}</span>}
          {m.toFix > 0 && <span className="text-xs text-danger">{m.toFix} to fix</span>}
        </span>
      ),
    },
    { key: 'taxable', header: 'Net taxable', render: (m) => (m.taxable == null ? '—' : formatMoney(m.taxable)) },
    { key: 'tax', header: 'Net tax', render: (m) => (m.tax == null ? '—' : formatMoney(m.tax)) },
    { key: 'arn', header: 'ARN', render: (m) => (m.arn ? <span className="font-mono text-xs">{m.arn}</span> : '—') },
    {
      key: 'actions',
      header: '',
      render: (m) =>
        m.returnId ? (
          <Button size="sm" variant="secondary" onClick={() => navigate(`/app/gst/returns/${m.returnId}`)}>Open</Button>
        ) : (
          data.canWork && (
            <Button size="sm" loading={prepare.isPending} onClick={() => start(m)}>Prepare</Button>
          )
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-sm">
        <Select label="GSTIN" options={data.gstins.map((g) => ({ value: g.gstin, label: `${g.gstin} · ${g.legalName}` }))} value={data.gstin ?? ''} onChange={(e) => setGstin(e.target.value)} />
      </div>
      <Table columns={columns} rows={data.months} rowKey="period" empty={<EmptyState title="No months yet" message="Months appear from your start month on." />} />
      <p className="text-xs text-muted">The app prepares the return and its file. You upload and file it on the GST portal.</p>
    </div>
  );
}
