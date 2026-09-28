import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import { useOrg, useSetOrgStatus } from '../../api/admin';
import { formatDate } from '../../lib/time';
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Spinner } from '../../components/ui';
import SalonStatusBadge from './SalonStatusBadge';

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{value || '—'}</dd>
    </div>
  );
}

export default function SalonDetailPage() {
  const { id } = useParams();
  const orgQuery = useOrg(id);
  const setStatus = useSetOrgStatus(id);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (orgQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }

  if (orgQuery.isError) {
    return <EmptyState title="Salon not found" message={orgQuery.error.message} action={<Link to="/admin/salons" className="text-sm underline">Back to salons</Link>} />;
  }

  const org = orgQuery.data;
  const isActive = org.status === 'active';

  function changeStatus() {
    setStatus.mutate(isActive ? 'inactive' : 'active', {
      onSuccess: (updated) => {
        setConfirmOpen(false);
        toast.success(`${updated.name} is now ${updated.status}`);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <Link to="/admin/salons" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> All salons
      </Link>

      <PageHeader
        title={org.name}
        subtitle={<SalonStatusBadge status={org.status} />}
        actions={
          <Button variant={isActive ? 'danger' : 'primary'} onClick={() => setConfirmOpen(true)}>
            {isActive ? 'Deactivate salon' : 'Activate salon'}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Owner" value={org.ownerName} />
            <Detail label="Owner email" value={org.contactEmail} />
            <Detail label="Owner phone" value={org.contactPhone} />
            <Detail label="City" value={org.city} />
            <Detail label="Plan" value={<span className="capitalize">{org.plan}</span>} />
            <Detail label="Onboarded" value={formatDate(org.createdAt)} />
          </dl>
        </Card>

        <Card title="At a glance">
          <dl className="grid grid-cols-2 gap-4">
            {Object.entries(org.counts).map(([label, count]) => (
              <div key={label}>
                <dt className="text-xs capitalize text-muted">{label}</dt>
                <dd className="text-2xl font-bold text-brown">{count}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Branches" className="lg:col-span-3">
          <ul className="divide-y divide-border">
            {org.branches.map((branch) => (
              <li key={branch._id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {branch.name} <span className="text-muted">· {branch.city} · {branch.timezone}</span>
                </span>
                {branch.status !== 'active' && <Badge>Archived</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={changeStatus}
        loading={setStatus.isPending}
        danger={isActive}
        title={isActive ? `Deactivate ${org.name}?` : `Activate ${org.name}?`}
        message={
          isActive
            ? 'Everyone at this salon will be logged out right away and will not be able to log in until you activate it again. No data is deleted.'
            : 'The salon’s users will be able to log in again.'
        }
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
      />
    </>
  );
}
