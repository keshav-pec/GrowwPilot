import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatQty, isMeasured } from '../../../lib/inventory';
import { isValidRupees } from '../../../lib/money';
import { Button } from '../../../components/ui';
import { ProductPicker, QtyField } from '../actions/fields';

// Products and amounts for an order, a delivery or a return.
// lines: [{ sku, qty (counting units), price (text, ₹ per stock unit) }]. Prices only when showPrices.
export default function LinesEditor({ lines, onChange, showPrices, priceLabel = 'Price' }) {
  const [picking, setPicking] = useState(lines.length === 0);
  const change = (i, changes) => onChange(lines.map((l, n) => (n === i ? { ...l, ...changes } : l)));

  function add(sku) {
    if (!lines.some((l) => l.sku._id === sku._id)) onChange([...lines, { sku, qty: isMeasured(sku) ? sku.unitsPerStockUnit : 1, price: '' }]);
    setPicking(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <div key={l.sku._id} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-medium">{l.sku.name}</p>
            <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={`Remove ${l.sku.name}`} onClick={() => onChange(lines.filter((_, n) => n !== i))}>
              <Trash2 size={16} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <QtyField sku={l.sku} value={l.qty} onChange={(qty) => change(i, { qty })} />
            {showPrices && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  {priceLabel} per {l.sku.stockUnit} (₹)
                </span>
                <input
                  inputMode="decimal"
                  value={l.price}
                  placeholder="Optional"
                  onChange={(e) => change(i, { price: e.target.value })}
                  className={`rounded-lg border px-3 py-2 outline-none focus:border-gold ${l.price && !isValidRupees(l.price) ? 'border-danger' : 'border-border'}`}
                />
              </label>
            )}
          </div>
          {l.inStore != null && <p className="mt-1 text-xs text-muted">{formatQty(l.inStore, l.sku)} in store now</p>}
        </div>
      ))}
      {picking ? (
        <ProductPicker label="Add a product" onPick={add} />
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setPicking(true)}>
          Add a product
        </Button>
      )}
    </div>
  );
}

export const linesValid = (lines) => lines.length > 0 && lines.every((l) => l.qty >= 1 && (!l.price || isValidRupees(l.price)));
