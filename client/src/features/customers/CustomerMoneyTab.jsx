import { useNavigate } from 'react-router-dom';
import { useCustomerMoney } from '../../api/billingReports';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { METHOD_LABEL, billBadge } from '../../lib/billing';
import { Badge, EmptyState, Spinner, Table } from '../../components/ui';

const SOURCE = { CHECKOUT: 'At checkout', LATER: 'Paid later', ADVANCE: 'Advance', REFUND: 'Refund', MIGRATED: 'At checkout' };

// The customer's money with the salon: what they owe, their bills, payments and refunds (branches I may use)
export default function CustomerMoneyTab({ customerId, zone }) {
  const navigate = useNavigate();
  const money = useCustomerMoney(customerId);
  if (money.isPending) return <Spinner />;
  if (money.isError) return <EmptyState title="Couldn’t load bills" message={money.error.message} />;
  const { totalDue, totalBilled, advanceBalance, bills, payments, refunds } = money.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3 text-sm">
        {[
          ['Billed (after refunds)', totalBilled, 'text-brown'],
          ['Still owed', totalDue, totalDue > 0 ? 'text-orange' : 'text-brown'],
          ['Advance left', advanceBalance, 'text-brown'],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted">{label}</p>
            <p className={`text-lg font-semibold ${tone}`}>{formatMoney(value)}</p>
          </div>
        ))}
      </div>

      <section>
        <h3 className="mb-2 font-semibold text-brown">Bills</h3>
        <Table
          rows={bills}
          onRowClick={(b) => navigate(`/app/invoices/${b._id}`)}
          columns={[
            { key: 'number', header: 'Bill', render: (b) => <span className="font-mono">{b.invoiceNumber}</span> },
            { key: 'date', header: 'Date', render: (b) => formatDateTime(b.issuedAt, b.branchId?.timezone ?? zone) },
            { key: 'branch', header: 'Branch', render: (b) => b.branchId?.name },
            { key: 'total', header: 'Total', render: (b) => formatMoney(b.grandTotal - (b.creditedTotal ?? 0)) },
            { key: 'due', header: 'Due', render: (b) => (b.balanceDue > 0 ? <span className="text-orange">{formatMoney(b.balanceDue)}</span> : '—') },
            {
              key: 'status',
              header: 'Status',
              render: (b) => {
                const badge = billBadge(b);
                return <Badge tone={badge.tone}>{badge.label}</Badge>;
              },
            },
          ]}
          empty={<EmptyState title="No bills yet" />}
        />
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-brown">Payments</h3>
        <Table
          rows={payments}
          columns={[
            { key: 'date', header: 'Date', render: (p) => formatDateTime(p.receivedAt, zone) },
            { key: 'what', header: 'What', render: (p) => (p.kind === 'REFUND' ? 'Money given back' : SOURCE[p.source]) },
            { key: 'method', header: 'Method', render: (p) => `${METHOD_LABEL[p.method]}${p.reference ? ` · ${p.reference}` : ''}` },
            { key: 'branch', header: 'Branch', render: (p) => p.branch },
            { key: 'amount', header: 'Amount', render: (p) => <span className={p.status === 'REVERSED' ? 'text-muted line-through' : ''}>{p.kind === 'REFUND' ? '−' : ''}{formatMoney(p.amount)}</span> },
          ]}
          empty={<EmptyState title="No payments yet" />}
        />
      </section>

      {refunds.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold text-brown">Refunds</h3>
          <Table
            rows={refunds}
            onRowClick={(r) => navigate(`/app/invoices/${r.invoiceId}`)}
            columns={[
              { key: 'date', header: 'Date', render: (r) => formatDateTime(r.createdAt, zone) },
              { key: 'bill', header: 'Bill', render: (r) => r.invoiceNumber },
              { key: 'reason', header: 'Reason', render: (r) => r.reason },
              { key: 'amount', header: 'Value', render: (r) => formatMoney(r.creditTotal) },
              { key: 'status', header: 'Status', render: (r) => ({ REQUESTED: 'Waiting', DONE: r.creditNoteNumber ?? 'Done', REJECTED: 'Turned down' })[r.status] },
            ]}
          />
        </section>
      )}
    </div>
  );
}
