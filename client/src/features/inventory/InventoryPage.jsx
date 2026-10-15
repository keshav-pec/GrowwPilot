import { useSearchParams } from 'react-router-dom';
import { ClipboardList, LayoutGrid, Package, Settings } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useInventoryAccess } from '../../api/inventory/access';
import { EmptyState, PageHeader, Spinner, Tabs } from '../../components/ui';

// What each tab will hold. The tabs are filled in over the next phases (INVENTORY_PLAN.md).
const TABS = [
  {
    value: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    title: 'Your stock at a glance',
    message: 'What is in store, what is in use and what needs ordering will show here once you add products.',
  },
  {
    value: 'products',
    label: 'Products',
    icon: Package,
    title: 'No products yet',
    message: 'Adding products, one by one or from a spreadsheet, is coming next.',
  },
  {
    value: 'purchasing',
    label: 'Purchasing',
    icon: ClipboardList,
    title: 'No purchase orders yet',
    message: 'Suppliers, purchase orders and receiving deliveries will live here.',
  },
  {
    value: 'settings',
    label: 'Settings',
    icon: Settings,
    title: 'Inventory settings',
    message: 'Stores and stations, what the front desk may do, and approval limits will be set here.',
    action: 'inventory.manageSettings', // only shown to people who may change settings (owners)
  },
];

export default function InventoryPage() {
  const { activeBranch } = useAuth();
  const accessQuery = useInventoryAccess();
  const can = accessQuery.data?.can ?? {};

  const tabs = TABS.filter((t) => !t.action || can[t.action]);

  // The open tab lives in the URL (?tab=products), so a page refresh keeps it
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabs.find((t) => t.value === searchParams.get('tab')) ?? tabs[0];

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
          <Tabs tabs={tabs} value={tab.value} onChange={(value) => setSearchParams({ tab: value })} />
          <EmptyState icon={tab.icon} title={tab.title} message={tab.message} />
        </>
      )}
    </>
  );
}
