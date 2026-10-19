import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useRefund } from '../../api/refunds';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { METHOD_LABEL, percentLabel } from '../../lib/billing';
import { Button, EmptyState, Spinner } from '../../components/ui';

// A printable credit note (GST bills) or refund receipt
export default function RefundPage() {
  const { id } = useParams();
  const refundQuery = useRefund(id);
  if (refundQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (refundQuery.isError) return <EmptyState title="Refund not found" message={refundQuery.error.message} />;

  const { refund, creditNote: note, branch } = refundQuery.data;
  const zone = branch.timezone;
  const seller = note?.seller ?? {};
  const lines = note?.lines ?? refund.lines;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/app/invoices/${refund.invoiceId}`} className="text-sm text-muted hover:text-ink">
          ← Bill {refund.invoiceNumber}
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} /> Print / save as PDF
        </Button>
      </div>

      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-bg p-6 print:border-0 print:p-0">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-brown">{seller.tradeName ?? branch.name}</h1>
            {seller.legalName && seller.legalName !== seller.tradeName && <p className="text-sm">{seller.legalName}</p>}
            {seller.address && <p className="text-sm text-muted">{seller.address}</p>}
            {seller.gstin && (
              <p className="text-sm">
                GSTIN <span className="font-mono">{seller.gstin}</span>
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{note ? 'Credit note' : 'Refund'}</p>
            {note && <p className="font-mono text-sm font-semibold">{note.number}</p>}
            <p className="text-xs text-muted">{formatDateTime(note?.issuedAt ?? refund.decidedAt ?? refund.createdAt, zone)}</p>
            <p className="mt-1 text-xs">
              Against bill <span className="font-mono">{refund.invoiceNumber}</span>
            </p>
          </div>
        </div>

        <p className="mb-4 text-sm">
          <span className="text-xs text-muted">Customer</span>
          <br />
          {note?.customerSnapshot?.name ?? refund.customerName}
        </p>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 text-right font-medium">Qty</th>
              {note && <th className="py-2 text-right font-medium">Taxable</th>}
              {note && <th className="py-2 text-right font-medium">GST</th>}
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border">
                <td className="py-2">
                  {l.name}
                  {l.code && <span className="block text-xs text-muted">{l.code}</span>}
                </td>
                <td className="py-2 text-right">{l.qty}</td>
                {note && <td className="py-2 text-right">{formatMoney(l.taxableAmount)}</td>}
                {note && <td className="py-2 text-right text-muted">{percentLabel(l.taxRateBps)}</td>}
                <td className="py-2 text-right">{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto flex max-w-xs flex-col gap-1 text-sm">
          {note && (
            <>
              <Row label="Taxable value" value={formatMoney(note.taxableTotal)} />
              <Row label="CGST" value={formatMoney(note.cgstTotal)} />
              <Row label="SGST" value={formatMoney(note.sgstTotal)} />
            </>
          )}
          <div className="flex justify-between border-t border-border pt-1 text-base font-bold text-brown">
            <dt>Total</dt>
            <dd>{formatMoney(refund.creditTotal)}</dd>
          </div>
          {refund.cashRefund > 0 && <Row label={`Paid back (${METHOD_LABEL[refund.method]})`} value={formatMoney(refund.cashRefund)} />}
          {refund.dueReduced > 0 && <Row label="Taken off the amount owed" value={formatMoney(refund.dueReduced)} />}
        </dl>
        <p className="mt-6 text-sm">
          <span className="text-xs text-muted">Reason: </span>
          {refund.reason}
        </p>
      </div>
    </>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
