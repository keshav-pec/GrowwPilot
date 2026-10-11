import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStaffCommission } from '../../api/payroll';
import { formatAmount } from '../../lib/money';
import { formatPayDay, formatPercent } from '../../lib/payroll';

// Owners: commission earned in a month, line by line, each linked to its bill
export default function CommissionSection({ staffId, today }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const commissionQuery = useStaffCommission(staffId, month);
  const data = commissionQuery.data;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Commission earned</h3>
        <input
          type="month"
          value={month}
          max={today.slice(0, 7)}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="rounded-lg border border-border px-2 py-1 text-sm"
          aria-label="Month"
        />
      </div>

      {commissionQuery.isError ? (
        <p className="text-sm text-danger">{commissionQuery.error.message}</p>
      ) : !data ? (
        <div className="h-16 animate-pulse rounded-lg bg-surface" />
      ) : (
        <>
          <p className="text-lg font-semibold text-ink">{formatAmount(data.totalAmount)}</p>
          <p className="mb-2 text-sm text-muted">
            {data.count === 0
              ? 'No commission this month.'
              : `From ${data.count} paid ${data.count === 1 ? 'service' : 'services'} worth ${formatAmount(data.totalSales)}`}
          </p>
          {data.entries.length > 0 && (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {data.entries.map((entry) => (
                <li key={entry._id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div>
                    <p className="text-ink">{entry.serviceName}</p>
                    <p className="text-xs text-muted">
                      {formatPayDay(entry.day)} ·{' '}
                      <Link to={`/app/invoices/${entry.invoiceId}`} className="hover:underline">
                        {entry.invoiceNumber}
                      </Link>{' '}
                      · {formatPercent(entry.rateBps)} of {formatAmount(entry.saleAmount)}
                      {entry.rateSource === 'service_rate' && ' (special rate)'}
                    </p>
                  </div>
                  <span className="whitespace-nowrap font-medium">{formatAmount(entry.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Earned when a service is completed and paid, on what the customer actually paid after discounts.</p>
        </>
      )}
    </section>
  );
}
