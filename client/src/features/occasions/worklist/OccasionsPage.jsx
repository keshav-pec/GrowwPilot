import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { Settings } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useOfferSummary, useOffers } from '../../../api/occasions';
import { useDebounce } from '../../../lib/useDebounce';
import { MONTHS } from '../../../lib/occasions';
import { Button, EmptyState, Input, PageHeader, Select, Spinner, Tabs } from '../../../components/ui';
import OfferTable from './OfferTable';
import OfferCards from './OfferCards';
import OfferDrawer from './OfferDrawer';

const TABS = [
  { value: 'action', label: 'Action required' },
  { value: 'all', label: 'All eligible' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'booked', label: 'Booked' },
  { value: 'used', label: 'Used' },
  { value: 'excluded', label: 'Excluded' },
];
const EMPTY = {
  action: 'Nothing to do right now.',
  all: 'No customer has an offer this month at this branch.',
  contacted: 'No one contacted yet.',
  booked: 'No bookings linked to an offer yet.',
  used: 'No offer used yet.',
  excluded: 'No expired or withdrawn offers.',
};

// This month and the 12 before it, e.g. "2026-11" -> "November 2026"
function monthOptions(zone) {
  const now = DateTime.now().setZone(zone);
  return Array.from({ length: 13 }, (_, i) => {
    const d = now.minus({ months: i });
    return { value: `${d.year}-${d.month}`, label: `${MONTHS[d.month - 1]} ${d.year}` };
  });
}

// Customer occasions: who to contact this month, what their offer is, and the next step
export default function OccasionsPage() {
  const { user, activeBranch } = useAuth();
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounce(search, 300);
  const zone = activeBranch.timezone;
  const isOwner = user.role === 'OWNER';
  const manyBranches = user.branches.length > 1;

  const get = (name, fallback = '') => params.get(name) ?? fallback;
  const set = (name) => (e) => {
    const next = new URLSearchParams(params);
    const value = e?.target ? e.target.value : e;
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const [year, month] = (get('month') || '').split('-').map(Number);
  const scope = { type: get('type'), year: year || undefined, month: month || undefined, branch: get('branch', 'current') };
  const filters = { ...scope, tab: get('tab', 'action'), search: debounced.trim(), canMessage: get('canMessage'), assignee: get('assignee') };

  const summaryQuery = useOfferSummary(scope);
  const offersQuery = useOffers(filters);
  const offers = offersQuery.data?.pages.flatMap((p) => p.offers) ?? [];
  const shownMonth = summaryQuery.data ? `${MONTHS[summaryQuery.data.month - 1]} ${summaryQuery.data.year}` : '';
  const showBranch = scope.branch === 'all';
  const empty = <EmptyState title={EMPTY[filters.tab]} message={filters.search || filters.canMessage || filters.assignee || filters.type ? 'Try clearing the filters.' : undefined} />;

  return (
    <>
      <PageHeader
        title="Customer occasions"
        subtitle={`${showBranch ? 'All my branches' : activeBranch.name}${shownMonth ? ` · ${shownMonth}` : ''}`}
        actions={
          isOwner && (
            <Link to="/app/settings/occasions" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface">
              <Settings size={16} /> Settings
            </Link>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Eligible', summaryQuery.data?.eligible, 'all'],
          ['Needs action', summaryQuery.data?.needsAction, 'action'],
          ['Booked', summaryQuery.data?.booked, 'booked'],
          ['Used', summaryQuery.data?.used, 'used'],
        ].map(([label, value, tab]) => (
          <button key={label} type="button" onClick={() => set('tab')(tab)} className={`rounded-xl border p-4 text-left hover:bg-surface ${filters.tab === tab ? 'border-gold' : 'border-border'}`}>
            <p className="text-xs text-muted">{label}</p>
            <p className="text-2xl font-bold text-brown">{value ?? '…'}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Input aria-label="Search" placeholder="Search name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Occasion" placeholder="Both occasions" value={get('type')} onChange={set('type')} options={[{ value: 'BIRTHDAY', label: 'Birthday' }, { value: 'ANNIVERSARY', label: 'Anniversary' }]} />
        <Select aria-label="Month" placeholder="This month" value={get('month')} onChange={set('month')} options={monthOptions(zone).slice(1)} />
        <Select aria-label="Can be messaged" placeholder="Messaging: any" value={get('canMessage')} onChange={set('canMessage')} options={[{ value: 'yes', label: 'Can be messaged' }, { value: 'no', label: 'In-salon only' }]} />
        <Select aria-label="Assigned to" placeholder="Assigned: anyone" value={get('assignee')} onChange={set('assignee')} options={[{ value: 'me', label: 'Assigned to me' }, { value: 'none', label: 'Not assigned' }]} />
        {isOwner && manyBranches && (
          <Select aria-label="Branches" value={get('branch', 'current')} onChange={set('branch')} options={[{ value: 'current', label: activeBranch.name }, { value: 'all', label: 'All my branches' }]} />
        )}
      </div>

      <Tabs tabs={TABS} value={filters.tab} onChange={set('tab')} />

      {offersQuery.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner size={28} />
        </div>
      ) : offersQuery.isError ? (
        <EmptyState title="Couldn’t load the list" message={offersQuery.error.message} />
      ) : (
        <>
          <div className="hidden md:block">
            <OfferTable offers={offers} zone={zone} showBranch={showBranch} onOpen={setOpenId} empty={empty} />
          </div>
          <div className="md:hidden">
            <OfferCards offers={offers} zone={zone} showBranch={showBranch} onOpen={setOpenId} empty={empty} />
          </div>
          {offersQuery.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => offersQuery.fetchNextPage()} loading={offersQuery.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {openId && <OfferDrawer offerId={openId} zone={zone} onClose={() => setOpenId(null)} />}
    </>
  );
}
