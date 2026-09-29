import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Target } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAssignees, useLeads } from '../../api/leads';
import { LEAD_SOURCES, LEAD_STATUS_LABEL, isOverdue } from '../../lib/leads';
import { useDebounce } from '../../lib/useDebounce';
import { formatDate, formatDateTime } from '../../lib/time';
import { Button, EmptyState, Input, PageHeader, Select, Table } from '../../components/ui';
import LeadStatusBadge from '../../components/LeadStatusBadge';
import LeadFormModal from './LeadFormModal';
import LeadDrawer from './LeadDrawer';

// Filter chips across the top: every status, plus "Overdue follow-ups"
const CHIPS = [{ value: '', label: 'All' }, ...Object.entries(LEAD_STATUS_LABEL).map(([value, label]) => ({ value, label })), { value: 'overdue', label: 'Overdue follow-ups' }];

export default function LeadsPage() {
  const { activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const [searchParams, setSearchParams] = useSearchParams();
  const chip = searchParams.get('chip') || '';
  const source = searchParams.get('source') || '';
  const assignedTo = searchParams.get('assignedTo') || '';

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search);
  useEffect(() => {
    setFilter('search', debouncedSearch);
  }, [debouncedSearch]);

  function setFilter(key, value) {
    setSearchParams(
      (params) => {
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true }
    );
  }

  const leadsQuery = useLeads({
    status: chip && chip !== 'overdue' ? chip : undefined,
    overdue: chip === 'overdue' ? 'true' : undefined,
    source: source || undefined,
    assignedTo: assignedTo || undefined,
    search: debouncedSearch || undefined,
  });
  const assignees = useAssignees().data ?? [];
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState(searchParams.get('open')); // ?open=<id> opens that lead (from the dashboard)

  const columns = [
    {
      key: 'name',
      header: 'Lead',
      render: (l) => (
        <div>
          <p className="font-medium">{l.name}</p>
          <p className="text-xs text-muted">{l.phone}</p>
        </div>
      ),
    },
    { key: 'source', header: 'Source' },
    { key: 'service', header: 'Interested in', render: (l) => l.interestedServiceId?.name ?? '—' },
    { key: 'assigned', header: 'Assigned to', render: (l) => l.assignedToUserId?.name ?? '—' },
    { key: 'status', header: 'Status', render: (l) => <LeadStatusBadge status={l.status} /> },
    {
      key: 'followUp',
      header: 'Next follow-up',
      // Overdue follow-ups stand out in orange
      render: (l) =>
        l.nextFollowUpAt ? (
          <span className={isOverdue(l) ? 'font-medium text-orange' : ''}>
            {formatDateTime(l.nextFollowUpAt, zone)}
            {isOverdue(l) && ' · overdue'}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'created', header: 'Created', render: (l) => formatDate(l.createdAt, zone) },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`People who asked about ${activeBranch.name} but haven’t booked yet`}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> Add lead
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setFilter('chip', c.value)}
            className={`rounded-full border px-3 py-1 text-sm ${
              chip === c.value ? 'border-gold bg-gold font-medium text-ink' : c.value === 'overdue' ? 'border-orange/50 text-orange' : 'border-border text-muted hover:text-ink'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <Input placeholder="Name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select placeholder="All sources" options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} value={source} onChange={(e) => setFilter('source', e.target.value)} />
        <Select placeholder="Anyone" options={assignees.map((u) => ({ value: u._id, label: u.name }))} value={assignedTo} onChange={(e) => setFilter('assignedTo', e.target.value)} />
      </div>

      {leadsQuery.isError ? (
        <p className="text-sm text-danger">{leadsQuery.error.message}</p>
      ) : (
        <Table
          columns={columns}
          rows={leadsQuery.data}
          loading={leadsQuery.isPending}
          onRowClick={(l) => setSelectedId(l._id)}
          empty={<EmptyState icon={Target} title="No leads here" message="Add enquiries from Instagram, calls or walk-ins so nobody is forgotten." />}
        />
      )}

      {adding && <LeadFormModal onClose={() => setAdding(false)} />}
      {selectedId && <LeadDrawer leadId={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  );
}
