import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import { ArrowLeft, Package, Printer } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useSkus } from '../../../api/inventory/skus';
import { imageUrl, mainImage } from '../../../api/inventory/images';
import { costPerStockUnit, formatQty } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { Button, Spinner } from '../../../components/ui';

// Printable catalogue: every active product at the branch with its photo. Print it or save it as a PDF.
// Costs show only for people who may see them (the server leaves them out for everyone else).
export default function CataloguePrintPage() {
  const { user, activeBranch } = useAuth();
  const skusQuery = useSkus({ status: 'active', scope: 'branch', page: 1, perPage: 2000 });
  const rows = skusQuery.data?.rows ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/inventory?tab=products" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={14} /> Back to products
        </Link>
        <Button onClick={() => window.print()} disabled={skusQuery.isPending}>
          <Printer size={16} /> Print or save as PDF
        </Button>
      </div>

      <header className="mb-4">
        <h1 className="text-2xl font-bold text-brown">{user.org?.name} product catalogue</h1>
        <p className="text-sm text-muted">
          {activeBranch?.name} · {rows.length} products · {DateTime.now().setZone(activeBranch?.timezone).toFormat('d LLL yyyy')}
        </p>
      </header>

      {skusQuery.isPending ? (
        <Spinner size={24} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4">
          {rows.map((row) => {
            const photo = mainImage(row);
            return (
              <div key={row._id} className="break-inside-avoid overflow-hidden rounded-lg border border-border">
                <div className="aspect-square bg-surface">
                  {photo ? (
                    <img src={imageUrl(row._id, photo._id)} alt={row.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                      <Package size={32} />
                    </div>
                  )}
                </div>
                <div className="p-2 text-xs">
                  <p className="text-sm font-medium">{row.name}</p>
                  <p className="text-muted">
                    {row.code} · {row.category}
                    {row.brand && ` · ${row.brand}`}
                  </p>
                  {row.barcodes?.length > 0 && <p className="text-muted">Barcode {row.barcodes[0]}</p>}
                  <p>{formatQty(row.inStore, row)} in store</p>
                  {row.avgCost != null && (
                    <p>
                      {formatAmount(costPerStockUnit(row.avgCost, row))} per {row.stockUnit}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
