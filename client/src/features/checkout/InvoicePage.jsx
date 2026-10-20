import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, Download, History, Printer, Share2, Undo2, Wallet } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { downloadInvoicePdf, useInvoice, useInvoiceHistory, useReversePayment, useVoidInvoice } from '../../api/invoices';
import { useApproveRefund, useRejectRefund } from '../../api/refunds';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { METHOD_LABEL, billBadge, newRequestKey, percentLabel } from '../../lib/billing';
import { Badge, Button, EmptyState, Spinner } from '../../components/ui';
import RecordPaymentModal from '../billing/RecordPaymentModal';
import RefundModal from '../billing/RefundModal';
import ReasonModal from '../billing/ReasonModal';
import ShareBillModal from '../billing/ShareBillModal';

const REFUND_STATUS = { REQUESTED: { label: 'Waiting for an owner', tone: 'yellow' }, DONE: { label: 'Refunded', tone: 'brown' }, REJECTED: { label: 'Turned down', tone: 'neutral' } };

// A printable bill. The sidebar and top bar are hidden when printing (print:hidden in Shell).
// GST bills show the GSTIN, tax per line and the CGST/SGST table.
export default function InvoicePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const invoiceQuery = useInvoice(id);
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [asking, setAsking] = useState(null); // { kind: 'void' | 'reverse' | 'rejectRefund', id }
  const [sharing, setSharing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useInvoiceHistory(id, showHistory);
  const voidBill = useVoidInvoice();
  const reverse = useReversePayment();
  const approveRefund = useApproveRefund();
  const rejectRefund = useRejectRefund();

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
  if (invoice.status === 'DRAFT') return <Navigate to={invoice.appointmentId ? `/app/checkout/${invoice.appointmentId._id}` : `/app/bills/${invoice._id}/edit`} replace />;

  const branch = invoice.branchId;
  const seller = invoice.seller ?? {};
  const gst = invoice.gstRegistered;
  const badge = billBadge(invoice);
  const lineDiscounts = invoice.lines.reduce((sum, l) => sum + l.lineDiscount, 0);
  const billDiscount = invoice.lines.reduce((sum, l) => sum + l.billDiscountShare, 0);
  const salonName = seller.tradeName || user.org?.name;
  const permissions = invoice.permissions ?? {};
  const refunds = invoice.refunds ?? [];
  const pendingRefund = refunds.find((r) => r.status === 'REQUESTED');
  const done = (message) => ({
    onSuccess: () => {
      toast.success(message);
      setAsking(null);
    },
    onError: (err) => toast.error(err.message),
  });

  function confirmReason(reason) {
    if (asking.kind === 'void') voidBill.mutate({ _id: invoice._id, key: newRequestKey(), reason }, done('Bill voided'));
    if (asking.kind === 'reverse') reverse.mutate({ paymentId: asking.id, key: newRequestKey(), reason }, done('Payment reversed'));
    if (asking.kind === 'rejectRefund') rejectRefund.mutate({ _id: asking.id, key: newRequestKey(), note: reason }, done('Refund turned down'));
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/bills" className="text-sm text-muted hover:text-ink">
          ← Bills
        </Link>
        <div className="flex flex-wrap gap-2">
          {permissions.void && (
            <Button variant="ghost" onClick={() => setAsking({ kind: 'void' })}>
              <Ban size={16} /> Void bill
            </Button>
          )}
          {permissions.refund && !pendingRefund && invoice.refundStatus !== 'FULL' && (
            <Button variant="secondary" onClick={() => setRefunding(true)}>
              <Undo2 size={16} /> Refund / return
            </Button>
          )}
          {invoice.status === 'ISSUED' && invoice.balanceDue > 0 && (
            <Button onClick={() => setPaying(true)}>
              <Wallet size={16} /> Record payment
            </Button>
          )}
          {invoice.status === 'ISSUED' && (
            <Button variant="secondary" onClick={() => setSharing(true)}>
              <Share2 size={16} /> Send to customer
            </Button>
          )}
          <Button variant="secondary" onClick={() => downloadInvoicePdf(invoice).catch((err) => toast.error(err.message))}>
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
            <div className="mt-1 flex justify-end gap-1">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              {invoice.refundStatus === 'PARTIAL' && <Badge tone="orange">Part refunded</Badge>}
              {invoice.refundStatus === 'FULL' && <Badge tone="orange">Refunded</Badge>}
            </div>
          </div>
        </div>

        {invoice.status === 'VOID' && (
          <p className="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
            This bill was voided{invoice.voidedAt && ` on ${formatDateTime(invoice.voidedAt, branch.timezone)}`}: {invoice.voidReason}
          </p>
        )}
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
                      {line.kind === 'PRODUCT' ? 'Product' : line.staffName}
                      {line.sacCode && ` · SAC ${line.sacCode}`}
                      {line.hsnCode && ` · HSN ${line.hsnCode}`}
                      {line.refundedQty > 0 && <span className="text-orange"> · {line.refundedQty === line.qty ? 'refunded' : `${line.refundedQty} refunded`}</span>}
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
          {invoice.creditedTotal > 0 && <Row label="Refunded items" value={`−${formatMoney(invoice.creditedTotal)}`} muted />}
          {invoice.amountPaid > 0 && (invoice.balanceDue > 0 || invoice.refundedTotal > 0) && <Row label="Paid" value={formatMoney(invoice.amountPaid)} />}
          {invoice.refundedTotal > 0 && <Row label="Given back" value={`−${formatMoney(invoice.refundedTotal)}`} muted />}
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
                <li key={p._id} className={`flex justify-between gap-2 py-0.5 ${p.status === 'REVERSED' ? 'text-muted' : ''}`}>
                  <span>
                    <span className={p.status === 'REVERSED' ? 'line-through' : ''}>{p.kind === 'ADVANCE' ? 'From advance' : METHOD_LABEL[p.method]}</span>
                    {p.reference && <span className="text-muted"> · {p.reference}</span>}
                    <span className="text-xs text-muted"> · {formatDateTime(p.receivedAt, branch.timezone)}</span>
                    {p.status === 'REVERSED' && <span className="block text-xs">Reversed by {p.reversal?.byName}: {p.reversal?.reason}</span>}
                    {permissions.reversePayments && p.kind === 'PAYMENT' && p.status === 'VALID' && (
                      <button type="button" className="ml-2 text-xs text-danger underline print:hidden" onClick={() => setAsking({ kind: 'reverse', id: p._id })}>
                        Reverse
                      </button>
                    )}
                  </span>
                  <span className={p.status === 'REVERSED' ? 'line-through' : ''}>{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {refunds.length > 0 && (
          <div className="mt-6 print:hidden">
            <p className="mb-1 text-xs text-muted">Refunds</p>
            <ul className="flex flex-col gap-2 text-sm">
              {refunds.map((r) => (
                <li key={r._id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>
                      {r.lines.map((l) => `${l.qty} × ${l.name}${l.restock === 'DAMAGED' ? ' (damaged)' : ''}`).join(', ')}
                    </span>
                    <span className="font-medium">{formatMoney(r.creditTotal)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {r.reason} · asked by {r.requestedByName}
                    {r.decidedByName && ` · ${r.status === 'REJECTED' ? 'turned down' : 'approved'} by ${r.decidedByName}`}
                    {r.decisionNote && `: ${r.decisionNote}`}
                  </p>
                  {r.status === 'DONE' && (
                    <p className="mt-1 text-xs">
                      {r.cashRefund > 0 ? `${formatMoney(r.cashRefund)} given back (${METHOD_LABEL[r.method]})` : 'Nothing handed back'}
                      {r.dueReduced > 0 && ` · ${formatMoney(r.dueReduced)} off what was owed`} ·{' '}
                      <Link to={`/app/refunds/${r._id}`} className="underline">
                        {r.creditNoteNumber ? `Credit note ${r.creditNoteNumber}` : 'Refund receipt'}
                      </Link>
                    </p>
                  )}
                  {r.status === 'REQUESTED' && permissions.approveRefunds && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" loading={approveRefund.isPending} onClick={() => approveRefund.mutate({ _id: r._id, key: newRequestKey() }, done('Refund done'))}>
                        Approve refund
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setAsking({ kind: 'rejectRefund', id: r._id })}>
                        Turn down
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted">Thank you for visiting {salonName}!</p>
      </div>

      <div className="mx-auto mt-4 max-w-2xl print:hidden">
        <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-2 text-sm text-muted hover:text-ink">
          <History size={16} /> {showHistory ? 'Hide' : 'Show'} bill history
        </button>
        {showHistory && (
          <ol className="mt-2 flex flex-col gap-2 border-l border-border pl-4 text-sm">
            {history.isPending && <Spinner size={16} />}
            {history.data?.length === 0 && <li className="text-muted">Nothing recorded yet.</li>}
            {history.data?.map((h) => (
              <li key={h._id}>
                <p>{h.summary}</p>
                <p className="text-xs text-muted">
                  {h.actorName} ({h.actorRole}) · {formatDateTime(h.createdAt, branch.timezone)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {paying && <RecordPaymentModal invoice={invoice} onClose={() => setPaying(false)} />}
      {sharing && <ShareBillModal invoice={invoice} salonName={salonName} onClose={() => setSharing(false)} />}
      {refunding && <RefundModal invoice={invoice} mayApprove={permissions.refund === 'approve'} onClose={() => setRefunding(false)} />}
      {asking && (
        <ReasonModal
          title={{ void: 'Void this bill', reverse: 'Reverse this payment', rejectRefund: 'Turn down the refund' }[asking.kind]}
          message={
            {
              void: 'The bill number stays used and the bill shows as Void. Products go back to the store, and the appointment can be checked out again.',
              reverse: 'Use this when a payment was recorded by mistake (e.g. the card was declined). The amount becomes due again.',
              rejectRefund: 'The front desk sees your reason.',
            }[asking.kind]
          }
          confirmLabel={{ void: 'Void bill', reverse: 'Reverse payment', rejectRefund: 'Turn down' }[asking.kind]}
          loading={voidBill.isPending || reverse.isPending || rejectRefund.isPending}
          onClose={() => setAsking(null)}
          onConfirm={confirmReason}
        />
      )}
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
