import { useSearchParams } from 'react-router-dom';
import { useGstSetup } from '../../api/gst';
import { Badge, EmptyState, PageHeader, PageSpinner, Tabs } from '../../components/ui';
import GstOverviewTab from './GstOverviewTab';
import GstSalesTab from './GstSalesTab';
import GstAdvancesTab from './GstAdvancesTab';
import GstReturnsTab from './GstReturnsTab';
import GstSettingsTab from './GstSettingsTab';

const RECORD_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'sales', label: 'Sales & Returns' },
  { value: 'advances', label: 'Advances' },
  { value: 'returns', label: 'Returns' },
];
const SETTINGS_TAB = { value: 'settings', label: 'Settings' };

// The GST menu. Branch owners get Overview, Sales & Returns and Advances only if the business owner switched them on.
// The open tab lives in the URL (?tab=sales), so a refresh or a link keeps it.
export default function GstPage() {
  const setupQuery = useGstSetup();
  const [searchParams, setSearchParams] = useSearchParams();
  if (setupQuery.isPending) return <PageSpinner />;
  if (setupQuery.isError) return <EmptyState title="Couldn’t load GST" message={setupQuery.error.message} />;

  const setup = setupQuery.data;
  const tabs = setup.canViewTax ? [...RECORD_TABS, SETTINGS_TAB] : [SETTINGS_TAB];
  const requested = searchParams.get('tab');
  const tab = tabs.some((t) => t.value === requested) ? requested : tabs[0].value;

  return (
    <>
      <PageHeader title="GST" subtitle="Your tax record and GST setup" actions={setup.active ? <Badge tone="brown">Active</Badge> : <Badge tone="neutral">Not active</Badge>} />
      <Tabs tabs={tabs} value={tab} onChange={(value) => setSearchParams({ tab: value })} />
      {tab === 'overview' && <GstOverviewTab today={setup.today} onOpenSettings={() => setSearchParams({ tab: 'settings' })} />}
      {tab === 'sales' && <GstSalesTab today={setup.today} />}
      {tab === 'advances' && <GstAdvancesTab />}
      {tab === 'returns' && <GstReturnsTab />}
      {tab === 'settings' && <GstSettingsTab setup={setup} />}
    </>
  );
}
