import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useInvoice } from '../../api/invoices';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { Badge, Button, EmptyState, Spinner } from '../../components/ui';

const METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };

// A printable invoice. The sidebar and top bar are hidden when printing (print:hidden in Shell).
export default function InvoicePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const invoiceQuery = useInvoice(id);

  if (invoiceQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (invoiceQuery.isError) return <EmptyState title="Invoice not found" message={invoiceQuery.error.message} />;

  const invoice = invoiceQuery.data;
  const branch = invoice.branchId;
  const itemsTotal = invoice.lines.reduce((sum, l) => sum + l.price, 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/today" className="text-sm text-muted hover:text-ink">
          ← Day board
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} /> Print / save as PDF
        </Button>
      </div>

      <div className="mx-auto max-w-xl rounded-xl border border-border bg-bg p-6 print:border-0 print:p-0">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-brown">{user.org?.name}</h1>
            <p className="text-sm text-muted">
              {branch.name}
              {branch.address && ` · ${branch.address}`}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
            <p className="text-xs text-muted">{formatDateTime(invoice.paidAt, branch.timezone)}</p>
            <div className="mt-1">
              <Badge tone="brown">Paid</Badge>
            </div>
          </div>
        </div>

        <div className="mb-4 text-sm">
          <p className="text-xs text-muted">Billed to</p>
          <p className="font-medium">{invoice.customerId.name}</p>
          <p className="text-muted">{invoice.customerId.phone}</p>
        </div>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 font-medium">Service</th>
              <th className="py-2 font-medium">Stylist</th>
              <th className="py-2 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={i} className="border-b border-border">
                <td className="py-2">{line.serviceName}</td>
                <td className="py-2 text-muted">{line.staffName}</td>
                <td className="py-2 text-right">{formatMoney(line.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto flex max-w-xs flex-col gap-1 text-sm">
          {itemsTotal !== invoice.subtotal && (
            <div className="flex justify-between text-muted">
              <dt>Combo price</dt>
              <dd>−{formatMoney(itemsTotal - invoice.subtotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatMoney(invoice.subtotal)}</dd>
          </div>
          {invoice.discount > 0 && (
            <div className="flex justify-between text-muted">
              <dt>Discount</dt>
              <dd>−{formatMoney(invoice.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1 text-base font-bold text-brown">
            <dt>Total</dt>
            <dd>{formatMoney(invoice.total)}</dd>
          </div>
        </dl>

        {/* The payment split */}
        {invoice.payments.length > 0 && (
          <div className="mt-6">
            <p className="mb-1 text-xs text-muted">Paid by</p>
            <ul className="text-sm">
              {invoice.payments.map((p, i) => (
                <li key={i} className="flex justify-between py-0.5">
                  <span>
                    {METHOD_LABEL[p.method]}
                    {p.reference && <span className="text-muted"> · {p.reference}</span>}
                  </span>
                  <span>{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted">Thank you for visiting {user.org?.name}!</p>
      </div>
    </>
  );
}
