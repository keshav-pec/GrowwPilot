import { useState } from 'react';
import { Package } from 'lucide-react';
import { useSellableProducts } from '../../api/invoices';
import { formatMoney } from '../../lib/money';
import { useDebounce } from '../../lib/useDebounce';
import { Button, EmptyState, Input, Modal, Spinner } from '../../components/ui';

// "Add product" at checkout: search by name or code, or scan a barcode (the scanner types into the box and presses
// Enter). Shows the selling price and how many are in the store. Only retail products with a price are listed.
export default function ProductPickerModal({ onClose, onPick, busy }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 250);
  const products = useSellableProducts(debounced);
  const rows = products.data?.rows ?? [];

  function pickExact(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = rows.find((r) => r._id === products.data?.exactMatchId) ?? (rows.length === 1 ? rows[0] : null);
    if (exact && debounced === search.trim()) {
      onPick(exact);
      setSearch('');
    }
  }

  return (
    <Modal open onClose={onClose} title="Add product">
      <Input autoFocus placeholder="Search or scan a barcode" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={pickExact} aria-label="Search products" />
      <div className="mt-3 min-h-40">
        {products.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : products.isError ? (
          <p className="text-sm text-danger">{products.error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={Package} title="No products to sell" message={search ? 'Nothing matches. Try another name or code.' : 'Retail products with a selling price show up here. An owner sets the price in Inventory.'} />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {rows.map((p) => (
              <li key={p._id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted">
                    {[p.brand, p.code].filter(Boolean).join(' · ')} · <span className={p.inStore === 0 ? 'text-danger' : ''}>{p.inStore} in store</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span>{formatMoney(p.sellPrice)}</span>
                  <Button size="sm" onClick={() => onPick(p)} disabled={busy || p.inStore === 0}>
                    Add
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
