import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { useServices } from '../../api/catalog';
import { useRemoveServiceRate, useSetServiceRate } from '../../api/payroll';
import { formatPercent } from '../../lib/payroll';
import { Button, Input, Modal, Select } from '../../components/ui';

// Add or change one special rate
function ServiceRateModal({ staff, rate, takenServiceIds, onClose }) {
  const servicesQuery = useServices();
  const setRate = useSetServiceRate();
  const [serviceId, setServiceId] = useState(rate?.serviceId._id ?? '');
  const [percent, setPercent] = useState(rate ? String(rate.rateBps / 100) : '');
  const [error, setError] = useState(null);

  const options = (servicesQuery.data ?? [])
    .filter((s) => s.status === 'active' && (s._id === serviceId || !takenServiceIds.includes(s._id)))
    .map((s) => ({ value: s._id, label: s.name }));

  function save() {
    if (!serviceId) return setError('Choose a service');
    if (!/^\d+(\.\d{1,2})?$/.test(percent.trim()) || Number(percent) > 100) return setError('Enter a % between 0 and 100');
    setRate.mutate(
      { staffId: staff._id, serviceId, rateBps: Math.round(Number(percent) * 100) },
      {
        onSuccess: () => {
          toast.success('Special rate saved');
          onClose();
        },
        onError: (err) => setError(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={rate ? `Change ${staff.name}'s rate on ${rate.serviceId.name}` : `Special commission for ${staff.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={setRate.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Service" placeholder="Choose a service" options={options} value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={Boolean(rate)} />
        <Input label="Commission (%)" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} hint="0 = no commission on this service" />
        <p className="text-xs text-muted sm:col-span-2">Counts from the next paid bill. Commission already earned doesn’t change.</p>
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}

// "Special rates for services": e.g. 15% on Hair Colour instead of their normal 10%
export default function ServiceRatesSection({ staff, rates, normalBps, isOwner }) {
  const removeRate = useRemoveServiceRate();
  const [editing, setEditing] = useState(null); // null | 'new' | rate

  // Nothing to show the front desk if there are no special rates
  if (!isOwner && rates.length === 0) return null;

  function remove(rate) {
    removeRate.mutate(
      { staffId: staff._id, serviceId: rate.serviceId._id },
      { onSuccess: () => toast.success('Special rate removed'), onError: (err) => toast.error(err.message) }
    );
  }

  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Special rates for services</h3>
      <p className="mb-2 text-xs text-muted">
        {normalBps
          ? `Normal commission: ${formatPercent(normalBps)}. A special rate replaces it for that service.`
          : 'Only used while their pay includes commission.'}
      </p>
      {rates.length > 0 && (
        <ul className="mb-2 divide-y divide-border rounded-lg border border-border text-sm">
          {rates.map((rate) => (
            <li key={rate._id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>{rate.serviceId?.name ?? 'Removed service'}</span>
              <span className="ml-auto font-medium">{rate.rateBps === 0 ? 'No commission' : formatPercent(rate.rateBps)}</span>
              {isOwner && (
                <>
                  <button type="button" onClick={() => setEditing(rate)} className="rounded p-1 text-muted hover:bg-surface" aria-label="Change rate">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => remove(rate)} className="rounded p-1 text-muted hover:bg-surface" aria-label="Remove rate">
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
          Add a service rate
        </Button>
      )}
      {editing && (
        <ServiceRateModal
          staff={staff}
          rate={editing === 'new' ? null : editing}
          takenServiceIds={rates.map((r) => r.serviceId?._id)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
