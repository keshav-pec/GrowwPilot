import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Printer, Wallet } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useInvoice } from '../../api/invoices';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { METHOD_LABEL, billBadge, percentLabel } from '../../lib/billing';
import { Badge, Button, EmptyState, Spinner } from '../../components/ui';
import RecordPaymentModal from '../billing/RecordPaymentModal';

// A printable bill. The sidebar and top bar are hidden when printing (print:hidden in Shell).
// GST bills show the GSTIN, tax per line and the CGST/SGST table.
export default function InvoicePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const invoiceQuery = useInvoice(id);
  const [paying, setPaying] = useState(false);

  if (invoiceQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (invoiceQuery.isError) return <EmptyState title="Bill not found" message={invoiceQuery.error.message} />;

  const invoice = invoiceQuery.data;
  // A draft is finished on the checkout screen (approvals happen there too)
  if (invoice.status === 'DRAFT' && invoice.appointmentId) return <Navigate to={`/app/checkout/${invoice.appointmentId._id}`} replace />;

  const branch = invoice.branchId;
  const seller = invoice.seller ?? {};
  const gst = invoice.gstRegistered;
  const badge = billBadge(invoice);
  const lineDiscounts = invoice.lines.reduce((sum, l) => sum + l.lineDiscount, 0);
  const billDiscount = invoice.lines.reduce((sum, l) => sum + l.billDiscountShare, 0);
  const salonName = seller.tradeName || user.org?.name;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/bills" className="text-sm text-muted hover:text-ink">
          ← Bills
        </Link>
        <div className="flex gap-2">
          {invoice.status === 'ISSUED' && invoice.balanceDue > 0 && (
            <Button onClick={() => setPaying(true)}>
              <Wallet size={16} /> Record payment
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print / save as PDF
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-bg p-6 print:border-0 print:p-0">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-brown">{salonName}</h1>
            {gst && seller.legalName && seller.legalName !== salonName && <p className="text-sm">{seller.legalName}</p>}
            <p className="text-sm text-muted">
              {seller.branchName || branch.name}
              {(seller.address || branch.address) && ` · ${seller.address || branch.address}`}
            </p>
            {seller.gstin && (
              <p className="text-sm">
                GSTIN <span className="font-mono">{seller.gstin}</span>
                {seller.stateName && <span className="text-muted"> · {seller.stateName} ({seller.stateCode})</span>}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{gst ? 'Tax invoice' : 'Bill'}</p>
            <p className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
            <p className="text-xs text-muted">{formatDateTime(invoice.issuedAt, branch.timezone)}</p>
            <div className="mt-1">
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
          </div>
        </div>

        <div className="mb-4 text-sm">
          <p className="text-xs text-muted">Billed to</p>
          <p className="font-medium">{invoice.customerSnapshot?.name ?? invoice.customerId?.name}</p>
          <p className="text-muted">{invoice.customerSnapshot?.phone ?? invoice.customerId?.phone}</p>
        </div>

        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 text-right font-medium">Price</th>
                <th className="py-2 text-right font-medium">Discount</th>
                {gst && <th className="py-2 text-right font-medium">Taxable</th>}
                {gst && <th className="py-2 text-right font-medium">GST</th>}
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line._id} className="border-b border-border align-top">
                  <td className="py-2">
                    {line.name}
                    {line.qty > 1 && ` × ${line.qty}`}
                    <span className="block text-xs text-muted">
                      {line.staffName}
                      {line.sacCode && ` · SAC ${line.sacCode}`}
                    </span>
                  </td>
                  <td className="py-2 text-right">{formatMoney(line.unitPrice * line.qty)}</td>
                  <td className="py-2 text-right text-muted">{line.comboDiscount + line.lineDiscount + line.billDiscountShare > 0 ? `−${formatMoney(line.comboDiscount + line.lineDiscount + line.billDiscountShare)}` : '—'}</td>
                  {gst && <td className="py-2 text-right">{formatMoney(line.taxableAmount)}</td>}
                  {gst && <td className="py-2 text-right text-muted">{percentLabel(line.taxRateBps)}</td>}
                  <td className="py-2 text-right">{formatMoney(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto flex max-w-xs flex-col gap-1 text-sm">
          <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
          {invoice.comboDiscountTotal > 0 && <Row label="Combo price" value={`−${formatMoney(invoice.comboDiscountTotal)}`} muted />}
          {lineDiscounts > 0 && <Row label="Line discounts" value={`−${formatMoney(lineDiscounts)}`} muted />}
          {billDiscount > 0 && <Row label="Bill discount" value={`−${formatMoney(billDiscount)}`} muted />}
          {gst && (
            <>
              <Row label="Taxable value" value={formatMoney(invoice.taxableTotal)} muted />
              {invoice.taxSummary.map((t) => (
                <div key={t.rateBps}>
                  <Row label={`CGST ${percentLabel(t.rateBps / 2)}`} value={formatMoney(t.cgst)} muted />
                  <Row label={`SGST ${percentLabel(t.rateBps / 2)}`} value={formatMoney(t.sgst)} muted />
                </div>
              ))}
            </>
          )}
          <div className="flex justify-between border-t border-border pt-1 text-base font-bold text-brown">
            <dt>Total</dt>
            <dd>{formatMoney(invoice.grandTotal)}</dd>
          </div>
          {invoice.amountPaid > 0 && invoice.balanceDue > 0 && <Row label="Paid" value={formatMoney(invoice.amountPaid)} />}
          {invoice.balanceDue > 0 && (
            <div className="flex justify-between font-semibold text-orange">
              <dt>Balance due</dt>
              <dd>{formatMoney(invoice.balanceDue)}</dd>
            </div>
          )}
        </dl>
        {gst && <p className="mt-2 text-right text-xs text-muted">{invoice.pricesIncludeTax ? 'Prices include GST.' : 'GST added on top of the prices.'}</p>}

        {invoice.payments.length > 0 && (
          <div className="mt-6">
            <p className="mb-1 text-xs text-muted">Payments</p>
            <ul className="text-sm">
              {invoice.payments.map((p) => (
                <li key={p._id} className="flex justify-between gap-2 py-0.5">
                  <span>
                    {METHOD_LABEL[p.method]}
                    {p.reference && <span className="text-muted"> · {p.reference}</span>}
                    <span className="text-xs text-muted"> · {formatDateTime(p.receivedAt, branch.timezone)}</span>
                  </span>
                  <span>{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted">Thank you for visiting {salonName}!</p>
      </div>

      {paying && <RecordPaymentModal invoice={invoice} onClose={() => setPaying(false)} />}
    </>
  );
}

function Row({ label, value, muted = false }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
