import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useInventoryAccess } from '../../api/inventory/access';
import { useSetup } from '../../api/inventory/setup';
import { EmptyState, PageHeader, Spinner, Tabs } from '../../components/ui';
import ProductsTab from './products/ProductsTab';
import ProductDrawer from './products/ProductDrawer';
import LocationsCard from './settings/LocationsCard';
import SetupGuide from './setup/SetupGuide';
import SetupChecklist from './setup/SetupChecklist';
import OverviewTab from './overview/OverviewTab';
import RecipesTab from './recipes/RecipesTab';
import PurchasingTab from './purchasing/PurchasingTab';
import OrderDrawer from './purchasing/OrderDrawer';
import StockCountTab from './stockCount/StockCountTab';

// The tabs (INVENTORY_PLAN.md). `action`: only shown to people who may do it.
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'products', label: 'Products' },
  { value: 'recipes', label: 'Recipes', action: 'inventory.viewRecipes' }, // owners and inventory logins
  { value: 'purchasing', label: 'Purchasing' },
  { value: 'count', label: 'Stock count', action: 'inventory.countStock' }, // owners and inventory logins
  { value: 'settings', label: 'Settings', action: 'inventory.manageSettings' }, // owners only
];

// "Set up later" is remembered in this browser, per branch, so the guide doesn't keep opening by itself
const laterKey = (branchId) => `gp_inventory_setup_later:${branchId}`;
function setupPutOff(branchId) {
  try {
    return localStorage.getItem(laterKey(branchId)) === '1';
  } catch {
    return false;
  }
}
function putOffSetup(branchId) {
  try {
    localStorage.setItem(laterKey(branchId), '1');
  } catch {
    // private window: the guide may simply open again next time
  }
}

export default function InventoryPage() {
  const { activeBranch, activeBranchId } = useAuth();
  const accessQuery = useInventoryAccess();
  const can = accessQuery.data?.can ?? {};
  // Owners and inventory logins set up stock; the front desk never sees the guide
  const canSetUp = Boolean(can['inventory.editProducts']);
  const setupQuery = useSetup();
  const setup = setupQuery.data;
  const setupOpen = canSetUp && setup && !setup.completedAt;

  const tabs = TABS.filter((t) => !t.action || can[t.action]);

  // The open tab and product live in the URL (?tab=products&product=<id>), so a refresh or a bell link keeps them.
  // A branch that is new to Inventory opens the setup guide instead of an empty page.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const newToInventory = setupOpen && setup.counts.products === 0 && !setupPutOff(activeBranchId);
  let tab = 'overview';
  if (requested === 'setup') tab = setupOpen ? 'setup' : 'overview';
  else if (tabs.some((t) => t.value === requested)) tab = requested;
  else if (!requested && newToInventory) tab = 'setup';
  const productId = searchParams.get('product');
  const orderId = searchParams.get('order');

  // Opening the guide puts it in the URL, so it stays open while the first products are added
  useEffect(() => {
    if (!requested && newToInventory) setSearchParams({ tab: 'setup' }, { replace: true });
  }, [requested, newToInventory, setSearchParams]);

  function update(changes) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    setSearchParams(next);
  }

  const loading = accessQuery.isPending || (canSetUp && setupQuery.isPending);

  return (
    <>
      <PageHeader title="Inventory" subtitle={`Stock at ${activeBranch?.name}`} />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size={28} />
        </div>
      ) : accessQuery.isError ? (
        <p className="text-sm text-danger">{accessQuery.error.message}</p>
      ) : tab === 'setup' ? (
        <SetupGuide
          setup={setup}
          can={can}
          onLeave={() => {
            putOffSetup(activeBranchId);
            update({ tab: 'overview' });
          }}
          onFinished={() => update({ tab: 'overview' })}
          onOpenProducts={() => update({ tab: 'products' })}
        />
      ) : (
        <>
          <Tabs tabs={tabs} value={tab} onChange={(value) => update({ tab: value })} />

          {tab === 'overview' && (
            <>
              {setupOpen && <SetupChecklist setup={setup} onContinue={() => update({ tab: 'setup' })} />}
              <OverviewTab can={can} onOpenProduct={(id) => update({ product: id })} />
            </>
          )}
          {tab === 'products' && <ProductsTab can={can} onOpenProduct={(id) => update({ product: id })} />}
          {tab === 'recipes' && <RecipesTab can={can} />}
          {tab === 'purchasing' && <PurchasingTab can={can} onOpenOrder={(id) => update({ order: id })} />}
          {tab === 'count' && <StockCountTab />}
          {tab === 'settings' && (
            <div className="grid gap-4">
              <LocationsCard />
              <EmptyState icon={Settings} title="More settings coming" message="What the front desk may do, and approval limits, will be set here." />
            </div>
          )}
        </>
      )}

      {productId && <ProductDrawer skuId={productId} can={can} onClose={() => update({ product: null })} />}
      {orderId && <OrderDrawer orderId={orderId} canSeeCosts={can['inventory.viewCosts']} onClose={() => update({ order: null })} />}
    </>
  );
}
