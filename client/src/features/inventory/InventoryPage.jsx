import { useSearchParams } from 'react-router-dom';
import { ClipboardList, LayoutGrid, Package, Settings } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useInventoryAccess } from '../../api/inventory/access';
import { EmptyState, PageHeader, Spinner, Tabs } from '../../components/ui';
import ProductsTab from './products/ProductsTab';
import ProductDrawer from './products/ProductDrawer';
import LocationsCard from './settings/LocationsCard';

// The tabs. Overview and Purchasing are filled in by later phases (INVENTORY_PLAN.md).
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'products', label: 'Products' },
  { value: 'purchasing', label: 'Purchasing' },
  { value: 'settings', label: 'Settings', action: 'inventory.manageSettings' }, // owners only
];

export default function InventoryPage() {
  const { activeBranch } = useAuth();
  const accessQuery = useInventoryAccess();
  const can = accessQuery.data?.can ?? {};

  const tabs = TABS.filter((t) => !t.action || can[t.action]);

  // The open tab and product live in the URL (?tab=products&product=<id>), so a refresh or a bell link keeps them
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabs.find((t) => t.value === searchParams.get('tab'))?.value ?? 'overview';
  const productId = searchParams.get('product');

  function update(changes) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    setSearchParams(next);
  }

  return (
    <>
      <PageHeader title="Inventory" subtitle={`Stock at ${activeBranch?.name}`} />

      {accessQuery.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner size={28} />
        </div>
      ) : accessQuery.isError ? (
        <p className="text-sm text-danger">{accessQuery.error.message}</p>
      ) : (
        <>
          <Tabs tabs={tabs} value={tab} onChange={(value) => update({ tab: value })} />

          {tab === 'overview' && (
            <EmptyState
              icon={LayoutGrid}
              title="Your stock at a glance"
              message="What is in store, what is in use and what needs ordering will show here. For now, see each product in the Products tab."
            />
          )}
          {tab === 'products' && <ProductsTab can={can} onOpenProduct={(id) => update({ product: id })} />}
          {tab === 'purchasing' && (
            <EmptyState icon={ClipboardList} title="No purchase orders yet" message="Suppliers, purchase orders and receiving deliveries will live here." />
          )}
          {tab === 'settings' && (
            <div className="grid gap-4">
              <LocationsCard />
              <EmptyState icon={Settings} title="More settings coming" message="What the front desk may do, and approval limits, will be set here." />
            </div>
          )}

          {productId && <ProductDrawer skuId={productId} canSeeCosts={can['inventory.viewCosts']} onClose={() => update({ product: null })} />}
        </>
      )}
    </>
  );
}
