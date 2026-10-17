import { DateTime } from 'luxon';
import { PackageCheck } from 'lucide-react';
import { useReceipts } from '../../../api/inventory/purchasing';
import { Badge, EmptyState, Spinner } from '../../../components/ui';

// Recent deliveries (with or without an order) and returns to suppliers at this branch
export default function DeliveriesList() {
  const receiptsQuery = useReceipts();
  if (receiptsQuery.isPending) return <Spinner size={24} />;
  const receipts = receiptsQuery.data ?? [];
  if (receipts.length === 0) return <EmptyState icon={PackageCheck} title="No deliveries yet" message="Deliveries and returns to suppliers show here." />;

  return (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
      {receipts.map((r) => (
        <li key={r._id} className="px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {r.kind === 'RETURN' ? <Badge tone="orange">Returned</Badge> : <Badge tone="brown">Received</Badge>}
            {r.lines.map((l) => `${l.qty} × ${l.skuName}`).join(', ')}
          </p>
          <p className="text-xs text-muted">
            {DateTime.fromISO(r.at).toFormat('d LLL, h:mm a')} · {r.by?.name}
            {r.supplierName && ` · ${r.supplierName}`}
            {r.poNumber && ` · ${r.poNumber}`}
            {r.invoiceNumber && ` · invoice ${r.invoiceNumber}`}
            {r.reason && ` · ${r.reason}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
