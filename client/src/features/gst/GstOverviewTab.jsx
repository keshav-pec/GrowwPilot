import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { refusalText, useGstOverview, useRunGstCheck } from '../../api/gst';
import { formatMoney } from '../../lib/money';
import { formatDateTime, formatMonth } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Button, Card, EmptyState, HEADLINE_TILE, Input, PageSpinner, Select, StatTile, SummaryRow } from '../../components/ui';

const INTERNAL_SETTINGS = '/app/gst?tab=settings';

// One month's output tax, and what needs attention. Everything else is one click away.
export default function GstOverviewTab({ today, onOpenSettings }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [gstin, setGstin] = useState('');
  const overview = useGstOverview({ month: month || undefined, gstin: gstin || undefined });
  const runCheck = useRunGstCheck();

  if (overview.isPending) return <PageSpinner />;
  if (overview.isError) return <EmptyState title="Couldn’t load the overview" message={overview.error.message} />;
  const data = overview.data;

  if (!data.active) {
    return (
      <EmptyState
        title="GST setup isn’t active"
        message="Your tax record begins when you activate GST setup."
        action={<Button onClick={onOpenSettings}>Open Settings</Button>}
      />
    );
  }

  const before = data.startMonth && data.month < data.startMonth;
  const attention = [...data.check.differences.map((d) => ({ key: d.key, message: d.message, link: d.link })), ...data.setupProblems.map((p) => ({ key: p.key, message: p.message, link: p.link })), ...(data.purchasesToDecide > 0 ? [{ key: 'purchases', message: `${data.purchasesToDecide} purchase bill${data.purchasesToDecide === 1 ? '' : 's'} this month ${data.purchasesToDecide === 1 ? 'needs' : 'need'} a credit decision.`, link: `/app/gst?tab=purchases&month=${data.month}` }] : [])];

  function checkNow() {
    runCheck.mutate(
      { key: newRequestKey() },
      {
        onSuccess: ({ checked, differences }) => (differences ? toast.error(`${differences} difference${differences === 1 ? '' : 's'} found`) : toast.success(`All ${checked} documents match the tax record`)),
        onError: (err) => toast.error(refusalText(err)),
      }
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <Input label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="min-w-72">
          <Select label="GSTIN" options={[{ value: '', label: 'All GSTINs' }, ...data.gstins.map((g) => ({ value: g.gstin, label: g.gstin }))]} value={gstin} onChange={(e) => setGstin(e.target.value)} />
        </div>
      </div>
      {before && <p className="rounded-lg bg-surface p-3 text-sm text-muted">Your tax record begins in {formatMonth(data.startMonth)}. Earlier months aren’t in it.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile {...HEADLINE_TILE} label="Output tax" value={formatMoney(data.net.tax)} hint={formatMonth(data.month)} />
        <StatTile {...HEADLINE_TILE} label="Taxable value" value={formatMoney(data.net.taxable)} hint="After credit notes, voids and advances used" />
        <StatTile {...HEADLINE_TILE} label="Money collected" value={formatMoney(data.collected)} hint="Received less handed back. Not the same as tax." />
        <StatTile {...HEADLINE_TILE} label="Bills" value={data.bills.count} hint={`${data.creditNotes.count} credit note${data.creditNotes.count === 1 ? '' : 's'}, ${data.voided.count} voided`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="This month’s tax">
          <dl className="flex flex-col gap-1 text-sm">
            <SummaryRow label="CGST" value={formatMoney(data.net.cgst)} />
            <SummaryRow label="SGST" value={formatMoney(data.net.sgst)} />
            <SummaryRow label="IGST" value={formatMoney(data.net.igst)} />
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold text-brown">
              <dt>Output tax</dt>
              <dd>{formatMoney(data.net.tax)}</dd>
            </div>
          </dl>
          {(data.advanceTaken.count > 0 || data.advanceUsed.count > 0) && (
            <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted">
              <SummaryRow label={`Included: tax on ${data.advanceTaken.count} advance${data.advanceTaken.count === 1 ? '' : 's'} taken`} value={formatMoney(data.advanceTaken.tax)} muted />
              <SummaryRow label="Included: advance tax used on bills" value={formatMoney(data.advanceUsed.tax)} muted />
            </dl>
          )}
          <p className="mt-3 text-xs text-muted">Please have your tax adviser check these before filing.</p>
        </Card>

        <Card
          title="Needs attention"
          actions={data.canRunCheck && (
            <Button size="sm" variant="secondary" loading={runCheck.isPending} onClick={checkNow}>
              Check now
            </Button>
          )}
        >
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 text-sm"><CheckCircle2 size={16} className="text-brown" /> Nothing needs attention.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {attention.map((item) => (
                <li key={item.key} className="flex items-start gap-2">
                  <CircleAlert size={16} className="mt-0.5 shrink-0 text-orange" />
                  <span>
                    {item.message}{' '}
                    {item.link && item.link !== INTERNAL_SETTINGS && <Link to={item.link} className="font-medium underline">Open</Link>}
                    {item.link === INTERNAL_SETTINGS && <button type="button" className="font-medium underline" onClick={onOpenSettings}>Open Settings</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">
            {data.check.ranAt ? `Bills last compared with the tax record on ${formatDateTime(data.check.ranAt)}: ${data.check.checked} documents.` : 'Bills are compared with the tax record every night.'}
          </p>
        </Card>
      </div>
    </div>
  );
}
