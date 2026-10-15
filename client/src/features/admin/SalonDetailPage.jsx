import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Package } from 'lucide-react';
import { useOrg, useSetOrgAddon, useSetOrgStatus } from '../../api/admin';
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

// Paid add-ons the Super Admin can switch on per salon
const ADDONS = [
  {
    key: 'inventory',
    name: 'Inventory',
    icon: Package,
    about: 'Stock, hand-outs to stylists, purchase orders and stock counts. Adds inventory logins in Team.',
    offWarning:
      'Inventory will disappear for everyone at this salon and inventory logins will be logged out. All stock data is kept and comes back when you switch it on again.',
  },
];

export default function SalonDetailPage() {
  const { id } = useParams();
  const orgQuery = useOrg(id);
  const setStatus = useSetOrgStatus(id);
  const setAddon = useSetOrgAddon(id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addonToSwitchOff, setAddonToSwitchOff] = useState(null);

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

  function switchAddon(addon, enabled) {
    setAddon.mutate(
      { addon: addon.key, enabled },
      {
        onSuccess: () => {
          setAddonToSwitchOff(null);
          toast.success(`${addon.name} is now ${enabled ? 'on' : 'off'} for ${org.name}`);
        },
        onError: (err) => toast.error(err.message),
      }
    );
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

        <Card title="Add-ons" className="lg:col-span-3">
          <ul className="divide-y divide-border">
            {ADDONS.map((addon) => {
              const on = Boolean(org.addons?.[addon.key]?.enabled);
              const Icon = addon.icon;
              return (
                <li key={addon.key} className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-3">
                    <Icon size={20} className="mt-0.5 shrink-0 text-brown" />
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {addon.name} {on ? <Badge tone="gold">On</Badge> : <Badge>Off</Badge>}
                      </p>
                      <p className="text-sm text-muted">{addon.about}</p>
                      {on && org.addons[addon.key].enabledAt && (
                        <p className="text-xs text-muted">Switched on {formatDate(org.addons[addon.key].enabledAt)}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={on ? 'secondary' : 'primary'}
                    onClick={() => (on ? setAddonToSwitchOff(addon) : switchAddon(addon, true))}
                    loading={setAddon.isPending && setAddon.variables?.addon === addon.key && !on}
                  >
                    {on ? 'Switch off' : 'Switch on'}
                  </Button>
                </li>
              );
            })}
          </ul>
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

      <ConfirmDialog
        open={Boolean(addonToSwitchOff)}
        onClose={() => setAddonToSwitchOff(null)}
        onConfirm={() => switchAddon(addonToSwitchOff, false)}
        loading={setAddon.isPending}
        danger
        title={`Switch off ${addonToSwitchOff?.name} for ${org.name}?`}
        message={addonToSwitchOff?.offWarning}
        confirmLabel="Switch off"
      />
    </>
  );
}
