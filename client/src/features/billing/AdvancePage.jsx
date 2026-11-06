import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Printer } from 'lucide-react';
import { downloadAdvancePdf, useAdvance } from '../../api/advances';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { METHOD_LABEL, percentLabel } from '../../lib/billing';
import { Button, EmptyState, PageSpinner, SummaryRow } from '../../components/ui';

// A printable receipt voucher (advances for named services) or advance receipt, with what happened to the money
export default function AdvancePage() {
  const { id } = useParams();
  const query = useAdvance(id);
  if (query.isPending) return <PageSpinner />;
  if (query.isError) return <EmptyState title="Advance not found" message={query.error.message} />;

  const { advance, branch, customer, uses } = query.data;
  const zone = branch.timezone;
  const g = advance.gst ?? {};

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/app/customers/${advance.customerId}`} className="text-sm text-muted hover:text-ink">
          ← {customer?.name}
        </Link>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => downloadAdvancePdf(advance).catch((err) => toast.error(err.message))}>
            <Download size={16} /> PDF
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-bg p-6 print:border-0 print:p-0">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-brown">{g.tradeName ?? branch.name}</h1>
            {g.legalName && g.legalName !== g.tradeName && <p className="text-sm">{g.legalName}</p>}
            <p className="text-sm text-muted">{[g.branchName ?? branch.name, g.address].filter(Boolean).join(' · ')}</p>
            {g.gstin && (
              <p className="text-sm">
                GSTIN <span className="font-mono">{g.gstin}</span>
                <span className="text-muted"> · {g.stateName} ({g.stateCode})</span>
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{advance.taxed ? 'Receipt voucher' : 'Advance receipt'}</p>
            {advance.receiptNumber && <p className="font-mono text-sm font-semibold">{advance.receiptNumber}</p>}
            <p className="text-xs text-muted">{formatDateTime(advance.createdAt, zone)}</p>
          </div>
        </div>

        <div className="mb-4 text-sm">
          <p className="text-xs text-muted">Received from</p>
          <p className="font-medium">{g.customerName ?? customer?.name}</p>
          {g.buyer?.gstin && (
            <p>
              {g.buyer.legalName} · GSTIN <span className="font-mono">{g.buyer.gstin}</span>
            </p>
          )}
          {g.placeOfSupply?.stateCode && <p className="text-muted">Place of supply: {g.placeOfSupply.stateName} ({g.placeOfSupply.stateCode})</p>}
        </div>

        <p className="mb-3 text-sm">
          {advance.forServices?.length > 0 ? `Advance for ${advance.forServices.map((f) => f.name).join(', ')}` : 'Advance'}
          {advance.taxed && <span className="text-muted"> · SAC {g.code} · {percentLabel(g.rateBps)}</span>}
          {advance.note && <span className="block text-xs text-muted">{advance.note}</span>}
        </p>

        <dl className="ml-auto flex max-w-xs flex-col gap-1 text-sm">
          {advance.taxed && (
            <>
              <SummaryRow label="Taxable value" value={formatMoney(g.taxable)} muted />
              {g.igst > 0 ? (
                <SummaryRow label={`IGST ${percentLabel(g.rateBps)}`} value={formatMoney(g.igst)} muted />
              ) : (
                <>
                  <SummaryRow label={`CGST ${percentLabel(g.rateBps / 2)}`} value={formatMoney(g.cgst)} muted />
                  <SummaryRow label={`SGST ${percentLabel(g.rateBps / 2)}`} value={formatMoney(g.sgst)} muted />
                </>
              )}
            </>
          )}
          <div className="flex justify-between border-t border-border pt-1 text-base font-bold text-brown">
            <dt>Received</dt>
            <dd>{formatMoney(advance.amount)}</dd>
          </div>
          <SummaryRow label="Left to use" value={formatMoney(advance.remaining)} />
        </dl>

        {advance.reversedAt && <p className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">The payment for this advance was reversed.</p>}

        {uses.length > 0 && (
          <div className="mt-6 print:hidden">
            <p className="mb-1 text-xs text-muted">Used on bills</p>
            <ul className="text-sm">
              {uses.map((u) => (
                <li key={`${u.invoiceId}-${u.at}`} className="flex justify-between gap-2 py-0.5">
                  <Link to={`/app/invoices/${u.invoiceId}`} className="underline">{u.invoiceNumber}</Link>
                  <span>
                    {formatMoney(u.amount)}
                    {u.advanceTax && <span className="text-xs text-muted"> · {formatMoney((u.advanceTax.cgst ?? 0) + (u.advanceTax.sgst ?? 0) + (u.advanceTax.igst ?? 0))} GST already paid</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {advance.refunds?.length > 0 && (
          <div className="mt-6">
            <p className="mb-1 text-xs text-muted">Given back</p>
            <ul className="flex flex-col gap-1 text-sm">
              {advance.refunds.map((r) => (
                <li key={r.paymentId}>
                  <p className="flex justify-between gap-2">
                    <span>
                      {r.number && <span className="font-mono">{r.number} · </span>}
                      {METHOD_LABEL[r.method]} · {formatDateTime(r.at, zone)}
                    </span>
                    <span>{formatMoney(r.amount)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {r.reason} · by {r.byName}
                    {advance.taxed && ` · includes ${formatMoney(r.cgst + r.sgst + r.igst)} GST`}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-8 text-center text-xs text-muted">
          {advance.taxed ? 'GST on this money has been charged here, so it is not charged again when the money is used on a bill.' : 'This money can be used on later bills.'}
        </p>
      </div>
    </>
  );
}
