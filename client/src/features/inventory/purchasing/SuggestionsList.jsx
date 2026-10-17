import { useState } from 'react';
import toast from 'react-hot-toast';
import { DateTime } from 'luxon';
import { ShoppingCart } from 'lucide-react';
import { useOrdersFromSuggestions, useSuggestions } from '../../../api/inventory/purchasing';
import { formatQty, newRequestKey } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { Button, EmptyState, Spinner } from '../../../components/ui';
import { QtyField } from '../actions/fields';

// Reorder suggestions: below the reorder point once stock already on approved orders is counted.
// Tick the ones to order; one draft order is made per supplier.
export default function SuggestionsList({ onCreated }) {
  const suggestionsQuery = useSuggestions();
  const create = useOrdersFromSuggestions();
  const [picked, setPicked] = useState({}); // skuId -> qty

  if (suggestionsQuery.isPending) return <Spinner size={24} />;
  if (suggestionsQuery.isError) return <p className="text-sm text-danger">{suggestionsQuery.error.message}</p>;
  const list = suggestionsQuery.data;
  if (list.length === 0) return <EmptyState icon={ShoppingCart} title="Nothing to order" message="Products show here when they drop to their reorder level (counting what is already on order)." />;

  const chosen = Object.entries(picked);

  function toggle(s) {
    setPicked((p) => {
      const next = { ...p };
      if (next[s.sku._id]) delete next[s.sku._id];
      else next[s.sku._id] = s.suggestedQty;
      return next;
    });
  }

  function createOrders() {
    create.mutate(
      { key: newRequestKey(), lines: chosen.map(([skuId, qty]) => ({ skuId, qty })) },
      {
        onSuccess: ({ orders }) => {
          toast.success(orders.length === 1 ? `Draft ${orders[0].number} created` : `${orders.length} draft orders created`);
          setPicked({});
          onCreated?.();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <>
      <ul className="mb-4 divide-y divide-border rounded-xl border border-border text-sm">
        {list.map((s) => (
          <li key={s.sku._id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <input type="checkbox" className="mt-1 accent-gold" aria-label={`Order ${s.sku.name}`} checked={Boolean(picked[s.sku._id])} onChange={() => toggle(s)} />
            <div className="min-w-48 flex-1">
              <p className="font-medium">{s.sku.name}</p>
              <p className="text-xs text-muted">
                {formatQty(s.available, s.sku)} in store · order at {formatQty(s.reorderPoint, s.sku)}
                {s.onOrder > 0 && ` · ${formatQty(s.onOrder, s.sku)} already on order`}
              </p>
              <p className="text-xs text-muted">
                {s.supplier ? s.supplier.name : 'No usual supplier yet'}
                {s.arrivesBy && ` · could arrive by ${DateTime.fromISO(s.arrivesBy).toFormat('d LLL')}`}
                {s.lastUnitCost != null && ` · last price ${formatAmount(s.lastUnitCost)}`}
              </p>
            </div>
            {picked[s.sku._id] ? (
              <div className="w-64">
                <QtyField sku={s.sku} label="Order" value={picked[s.sku._id]} onChange={(qty) => setPicked((p) => ({ ...p, [s.sku._id]: qty }))} />
              </div>
            ) : (
              <span className="text-sm">Suggested: {formatQty(s.suggestedQty, s.sku)}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button onClick={createOrders} loading={create.isPending} disabled={chosen.length === 0 || chosen.some(([, qty]) => qty < 1)}>
          Create draft orders ({chosen.length})
        </Button>
      </div>
    </>
  );
}
