import { Package } from 'lucide-react';
import { imageUrl, mainImage } from '../../../api/inventory/images';
import { formatQty } from '../../../lib/inventory';
import { Badge } from '../../../components/ui';

// The catalogue: one card per product with its main photo, name, category, brand and what is in the store
export default function CatalogueGrid({ rows, onOpen }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {rows.map((row) => {
        const photo = mainImage(row);
        return (
          <button key={row._id} type="button" onClick={() => onOpen(row._id)} className="overflow-hidden rounded-xl border border-border bg-bg text-left hover:border-gold hover:shadow-sm">
            <div className="relative aspect-square bg-surface">
              {photo ? (
                <img src={imageUrl(row._id, photo._id)} alt={row.name} loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted">
                  <Package size={36} />
                </div>
              )}
              {row.needToOrder && (
                <span className="absolute left-2 top-2">
                  <Badge tone="orange">Need to order</Badge>
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-medium">{row.name}</p>
              <p className="text-xs text-muted">
                {row.category}
                {row.brand && ` · ${row.brand}`}
              </p>
              {row.inStore != null && <p className="mt-1 text-xs">{formatQty(row.inStore, row)} in store</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
