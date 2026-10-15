import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { useLocations, useSaveLocation } from '../../../api/inventory/locations';
import { newRequestKey } from '../../../lib/inventory';
import { Badge, Button, Card, Input, Modal, Spinner } from '../../../components/ui';

const KIND_LABEL = { STORE: 'Store', IN_USE: 'In use', STATION: 'Station' };

// Stores and stations at the selected branch. Main store and In use are always there.
export default function LocationsCard() {
  const locationsQuery = useLocations();
  const saveLocation = useSaveLocation();
  const [editing, setEditing] = useState(null); // { kind } to add, or a location to rename

  function toggleActive(location) {
    saveLocation.mutate(
      { key: newRequestKey(), _id: location._id, active: !location.active },
      {
        onSuccess: () => toast.success(location.active ? `${location.name} closed` : `${location.name} reopened`),
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Card
      title="Stores and stations"
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'STORE' })}>
            <Plus size={14} /> Store
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'STATION' })}>
            <Plus size={14} /> Station
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Stores hold stock on the shelf. Stations are chairs or areas that receive stock, like “Chair 3” or “Colour bar”; what they have counts as In use.
      </p>
      {locationsQuery.isPending ? (
        <Spinner size={20} />
      ) : locationsQuery.isError ? (
        <p className="text-sm text-danger">{locationsQuery.error.message}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {locationsQuery.data.map((l) => (
            <li key={l._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex items-center gap-2">
                <span className={l.active ? '' : 'text-muted line-through'}>{l.name}</span>
                <Badge tone={l.kind === 'STATION' ? 'gold' : 'brown'}>{l.isMain ? 'Main store' : KIND_LABEL[l.kind]}</Badge>
                {!l.active && <Badge>Closed</Badge>}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                  Rename
                </Button>
                {!l.isMain && l.kind !== 'IN_USE' && (
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(l)} loading={saveLocation.isPending && saveLocation.variables?._id === l._id}>
                    {l.active ? 'Close' : 'Reopen'}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && <LocationNameModal location={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function LocationNameModal({ location, onClose }) {
  const saveLocation = useSaveLocation();
  const [key] = useState(newRequestKey);
  const [name, setName] = useState(location.name ?? '');
  const isNew = !location._id;
  const what = location.kind === 'STATION' ? 'station' : 'store';

  function save(e) {
    e.preventDefault();
    const values = isNew ? { kind: location.kind, name } : { _id: location._id, name };
    saveLocation.mutate(
      { key, ...values },
      {
        onSuccess: () => {
          toast.success('Saved');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? `Add a ${what}` : `Rename ${location.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="location-form" loading={saveLocation.isPending} disabled={name.trim().length < 2}>
            Save
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={save} className="flex flex-col gap-3">
        <Input label="Name" autoFocus placeholder={location.kind === 'STATION' ? 'e.g. Chair 3' : 'e.g. Back room'} value={name} onChange={(e) => setName(e.target.value)} />
        {saveLocation.isError && <p className="text-sm text-danger">{saveLocation.error.message}</p>}
      </form>
    </Modal>
  );
}
