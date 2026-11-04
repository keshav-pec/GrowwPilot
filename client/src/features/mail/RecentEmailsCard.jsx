import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useMailLog } from '../../api/mail';
import { formatDateTime } from '../../lib/time';
import { Badge, Card, Input, Pagination, Select, Table } from '../../components/ui';

const KINDS = [
  { value: '', label: 'All kinds' },
  { value: 'OCCASION_OFFER', label: 'Occasion offers' },
  { value: 'BILL', label: 'Bills' },
  { value: 'PASSWORD', label: 'Password links' },
  { value: 'TEST', label: 'Test emails' },
];
const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'SENT', label: 'Sent' },
  { value: 'WAITING', label: 'Waiting' },
  { value: 'FAILED', label: 'Not sent' },
  { value: 'SKIPPED', label: 'Skipped' },
];
const STATUS_BADGE = {
  PENDING: { label: 'Waiting', tone: 'yellow' },
  SENDING: { label: 'Sending', tone: 'yellow' },
  SENT: { label: 'Sent', tone: 'gold' },
  FAILED: { label: 'Not sent', tone: 'danger' },
  SKIPPED: { label: 'Skipped', tone: 'neutral' },
};

// Email → Recent emails: what the app emailed for the salon, newest first, with the reason when one wasn't sent.
// No email body is shown and addresses are partly hidden. Branch owners see their branches' emails only.
export default function RecentEmailsCard() {
  const { activeBranch } = useAuth();
  const zone = activeBranch?.timezone;
  const [filters, setFilters] = useState({ kind: '', status: '', from: '', to: '', page: 1 });
  const logQuery = useMailLog(filters);
  const set = (field) => (e) => setFilters((f) => ({ ...f, [field]: e.target.value, page: 1 }));
  const data = logQuery.data;

  const columns = [
    { key: 'when', header: 'When', render: (e) => formatDateTime(e.createdAt, zone) },
    {
      key: 'what',
      header: 'Email',
      render: (e) => (
        <span>
          {e.kindLabel}
          {e.automatic && <span className="text-xs text-muted"> · automatic</span>}
          <span className="block text-xs text-muted">{e.subject}</span>
        </span>
      ),
    },
    { key: 'to', header: 'To', render: (e) => e.to },
    { key: 'branch', header: 'Branch · by', render: (e) => [e.branchName, e.by].filter(Boolean).join(' · ') || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (e) => (
        <span>
          <Badge tone={STATUS_BADGE[e.status].tone}>{e.via === 'LOG' && e.status === 'SENT' ? 'Logged (not sent)' : STATUS_BADGE[e.status].label}</Badge>
          {e.error && <span className={`mt-1 block max-w-xs text-xs ${e.status === 'SENT' ? 'text-muted' : 'text-danger'}`}>{e.error}</span>}
        </span>
      ),
    },
  ];

  return (
    <Card title="Recent emails">
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Select id="mail-kind" label="Kind" options={KINDS} value={filters.kind} onChange={set('kind')} />
        <Select id="mail-status" label="Status" options={STATUSES} value={filters.status} onChange={set('status')} />
        <Input id="mail-from" label="From" type="date" value={filters.from} onChange={set('from')} />
        <Input id="mail-to" label="To" type="date" value={filters.to} onChange={set('to')} />
      </div>
      {logQuery.isError ? (
        <p className="text-sm text-danger">{logQuery.error.message}</p>
      ) : (
        <>
          <Table columns={columns} rows={data?.emails ?? []} loading={logQuery.isPending} empty={<p className="py-6 text-center text-sm text-muted">No emails yet.</p>} />
          {data && <Pagination page={data.page} pages={Math.ceil(data.total / data.pageSize)} onChange={(page) => setFilters((f) => ({ ...f, page }))} />}
        </>
      )}
      <p className="mt-2 text-xs text-muted">Emails are kept for 180 days. The email itself isn’t shown here, and addresses are partly hidden.</p>
    </Card>
  );
}
