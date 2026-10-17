import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Images, LayoutGrid, List, Package, Plus, Printer, Search, Upload } from 'lucide-react';
import { fetchSkus, useSkus, useUseSkuHere } from '../../../api/inventory/skus';
import { useSuppliers } from '../../../api/inventory/suppliers';
import { WAYS_OF_USE, WAY_OF_USE_LABEL, formatQty, newRequestKey } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { useDebounce } from '../../../lib/useDebounce';
import { Badge, Button, EmptyState, Pagination, Select, Table } from '../../../components/ui';
import ProductFormModal from './ProductFormModal';
import ImportModal from '../import/ImportModal';
import CatalogueGrid from '../catalogue/CatalogueGrid';
import BulkPhotosModal from '../catalogue/BulkPhotosModal';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'Active and inactive' },
];

// Products screen (INV-02): search by name, code or barcode. A barcode scanner types into the search box
// and presses Enter, which opens the product straight away.
export default function ProductsTab({ can, onOpenProduct }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ category: '', wayOfUse: '', supplierId: '', status: 'active', needToOrder: false });
  const suppliers = useSuppliers().data ?? [];
  const [otherProducts, setOtherProducts] = useState(false); // the salon's products not used at this branch yet
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bulkPhotos, setBulkPhotos] = useState(false);
  // List or catalogue (photo cards); remembered in this browser
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('gp_inventory_view') === 'catalogue' ? 'catalogue' : 'list';
    } catch {
      return 'list';
    }
  });
  function changeView(next) {
    setView(next);
    try {
      localStorage.setItem('gp_inventory_view', next);
    } catch {
      // private window: not remembered
    }
  }
  const useHere = useUseSkuHere();

  const debouncedSearch = useDebounce(search.trim());
  const query = {
    search: debouncedSearch || undefined,
    category: filters.category || undefined,
    wayOfUse: filters.wayOfUse || undefined,
    supplierId: filters.supplierId || undefined,
    status: filters.status,
    needToOrder: filters.needToOrder || undefined,
    scope: otherProducts ? 'salon' : 'branch',
    page,
  };
  const skusQuery = useSkus(query);
  const { rows = [], pages = 1, total = 0, categories = [] } = skusQuery.data ?? {};

  const canEdit = can['inventory.editProducts'];
  const canSeeCosts = can['inventory.viewCosts'];

  function setFilter(name, value) {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  }

  // Enter (or a scanner) with an exact code or barcode opens that product
  async function handleSearchKey(e) {
    if (e.key !== 'Enter' || !search.trim()) return;
    const exactQuery = { ...query, search: search.trim(), page: 1 };
    const result = await queryClient.fetchQuery({ queryKey: ['inventory', 'skus', exactQuery], queryFn: () => fetchSkus(exactQuery) });
    if (result.exactMatchId) onOpenProduct(result.exactMatchId);
  }

  function startUsingHere(row) {
    useHere.mutate(
      { key: newRequestKey(), _id: row._id },
      { onSuccess: () => toast.success(`${row.name} is now used at this branch`), onError: (err) => toast.error(err.message) }
    );
  }

  const columns = [
    {
      key: 'name',
      header: 'Product',
      render: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted">
            {r.code}
            {r.brand && ` · ${r.brand}`}
          </p>
        </div>
      ),
    },
    { key: 'category', header: 'Category' },
    { key: 'wayOfUse', header: 'Way of use', render: (r) => WAY_OF_USE_LABEL[r.wayOfUse] },
    ...(otherProducts
      ? [
          {
            key: 'useHere',
            header: '',
            render: (r) =>
              canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={useHere.isPending && useHere.variables?._id === r._id}
                  onClick={(e) => {
                    e.stopPropagation();
                    startUsingHere(r);
                  }}
                >
                  Use here
                </Button>
              ),
          },
        ]
      : [
          { key: 'inStore', header: 'In store', render: (r) => formatQty(r.inStore, r) },
          { key: 'inUse', header: 'In use', render: (r) => formatQty(r.inUse, r) },
          ...(canSeeCosts ? [{ key: 'value', header: 'Value', render: (r) => (r.value == null ? '—' : formatAmount(r.value)) }] : []),
          {
            key: 'status',
            header: '',
            render: (r) => (
              <div className="flex gap-1">
                {r.needToOrder && <Badge tone="orange">Need to order</Badge>}
                {r.status === 'inactive' && <Badge>Inactive</Badge>}
              </div>
            ),
          },
        ]),
  ];

  const filtered = Boolean(debouncedSearch || filters.category || filters.wayOfUse || filters.supplierId || filters.needToOrder || filters.status !== 'active');

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <label className="relative flex-1">
          <span className="sr-only">Search products</span>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            onKeyDown={handleSearchKey}
            placeholder="Search by name, code, or scan a barcode"
            className="w-full rounded-lg border border-border bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
        </label>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload size={16} /> Import
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> Add product
            </Button>
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          aria-label="Category"
          placeholder="All categories"
          options={categories.map((c) => ({ value: c, label: c }))}
          value={filters.category}
          onChange={(e) => setFilter('category', e.target.value)}
        />
        <Select aria-label="Way of use" placeholder="Every way of use" options={WAYS_OF_USE} value={filters.wayOfUse} onChange={(e) => setFilter('wayOfUse', e.target.value)} />
        {suppliers.length > 0 && (
          <Select aria-label="Supplier" placeholder="Every supplier" options={suppliers.map((s) => ({ value: s._id, label: s.name }))} value={filters.supplierId} onChange={(e) => setFilter('supplierId', e.target.value)} />
        )}
        <Select aria-label="Status" options={STATUS_OPTIONS} value={filters.status} onChange={(e) => setFilter('status', e.target.value)} />
        {!otherProducts && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-gold" checked={filters.needToOrder} onChange={(e) => setFilter('needToOrder', e.target.checked)} />
            Need to order only
          </label>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setOtherProducts((v) => !v);
              setPage(1);
            }}
            className="text-sm text-brown underline"
          >
            {otherProducts ? '← Back to this branch’s products' : 'Show the salon’s products not used at this branch'}
          </button>
        ) : (
          <span />
        )}
        {!otherProducts && (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setBulkPhotos(true)}>
                <Images size={14} /> Upload photos in bulk
              </Button>
            )}
            <Link to="/app/inventory/catalogue" className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm hover:bg-surface">
              <Printer size={14} /> Print catalogue
            </Link>
            <div className="flex rounded-lg border border-border" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')} className={`flex items-center gap-1 px-3 py-1.5 text-sm ${view === 'list' ? 'bg-gold/20 font-medium' : ''}`}>
                <List size={14} /> List
              </button>
              <button type="button" aria-pressed={view === 'catalogue'} onClick={() => changeView('catalogue')} className={`flex items-center gap-1 px-3 py-1.5 text-sm ${view === 'catalogue' ? 'bg-gold/20 font-medium' : ''}`}>
                <LayoutGrid size={14} /> Catalogue
              </button>
            </div>
          </div>
        )}
      </div>

      {skusQuery.isError ? (
        <p className="text-sm text-danger">{skusQuery.error.message}</p>
      ) : view === 'catalogue' && !otherProducts && rows.length > 0 ? (
        <CatalogueGrid rows={rows} onOpen={onOpenProduct} />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          loading={skusQuery.isPending}
          onRowClick={(r) => onOpenProduct(r._id)}
          empty={
            filtered || otherProducts ? (
              <EmptyState icon={Search} title="No products match" message={otherProducts ? 'Every product of the salon is already used here.' : 'Try another search or filter.'} />
            ) : (
              <EmptyState
                icon={Package}
                title="No products yet"
                message="Add the products you keep in stock. Only the name, category, stock unit and way of use are needed."
                action={
                  canEdit && (
                    <Button onClick={() => setAdding(true)}>
                      <Plus size={16} /> Add product
                    </Button>
                  )
                }
              />
            )
          }
        />
      )}
      {total > 0 && <p className="mt-2 text-xs text-muted">{total === 1 ? '1 product' : `${total} products`}</p>}
      <Pagination page={page} pages={pages} onChange={setPage} />

      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {bulkPhotos && <BulkPhotosModal onClose={() => setBulkPhotos(false)} />}
      {adding && <ProductFormModal categories={categories} canSeeCosts={canSeeCosts} onClose={() => setAdding(false)} onSaved={(sku) => onOpenProduct(sku._id)} />}
    </>
  );
}
