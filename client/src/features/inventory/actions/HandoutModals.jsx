import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMoveHandout, useReturnUnused } from '../../../api/inventory/allocations';
import { useLocations } from '../../../api/inventory/locations';
import { formatQty, newRequestKey, recipientFromValue } from '../../../lib/inventory';
import { Button, Input, Modal } from '../../../components/ui';
import { QtyField, RecipientSelect, StoreSelect } from './fields';

function Footer({ onClose, onSave, saving, disabled, label }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onSave} loading={saving} disabled={disabled}>
        {label}
      </Button>
    </>
  );
}

// Return unused stock from a hand-out to a store (only when it can still be used)
export function ReturnModal({ handout, onClose }) {
  const returnUnused = useReturnUnused();
  const locations = useLocations().data ?? [];
  const [key] = useState(newRequestKey);
  const [qty, setQty] = useState(handout.remainingQty);
  const [storeId, setStoreId] = useState(null);
  const [note, setNote] = useState('');
  const store = locations.find((l) => l._id === storeId) ?? locations.find((l) => l.isMain);

  function save() {
    returnUnused.mutate(
      { key, id: handout._id, qty, locationId: store?._id, note: note || undefined },
      {
        onSuccess: () => {
          toast.success(`${formatQty(qty, handout.sku)} back in ${store.name}`);
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Return ${handout.sku.name} unused`}
      footer={<Footer onClose={onClose} onSave={save} saving={returnUnused.isPending} disabled={qty < 1 || qty > handout.remainingQty} label="Return to store" />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {handout.recipient.name} has {formatQty(handout.remainingQty, handout.sku)}. Only return it if it can still be used; otherwise write it off.
        </p>
        <QtyField sku={handout.sku} label="Returning" value={qty} onChange={setQty} />
        <StoreSelect label="To" value={store?._id} onChange={setStoreId} />
        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {returnUnused.isError && <p className="text-sm text-danger">{returnUnused.error.message}</p>}
      </div>
    </Modal>
  );
}

// Move a hand-out (or part of it) to another stylist or station. Nothing is used up.
export function MoveModal({ handout, onClose }) {
  const move = useMoveHandout();
  const [key] = useState(newRequestKey);
  const [qty, setQty] = useState(handout.remainingQty);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');

  function save() {
    move.mutate(
      { key, id: handout._id, recipient: recipientFromValue(recipient), qty, note: note || undefined },
      {
        onSuccess: ({ moved }) => {
          toast.success(`Moved to ${moved.recipient.name}`);
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Move ${handout.sku.name}`}
      footer={<Footer onClose={onClose} onSave={save} saving={move.isPending} disabled={!recipient || qty < 1 || qty > handout.remainingQty} label="Move" />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {handout.recipient.name} has {formatQty(handout.remainingQty, handout.sku)}.
          {handout.needsHandover && ' They no longer work here, so hand it to someone else.'}
        </p>
        <RecipientSelect label="Move to" value={recipient} onChange={setRecipient} />
        <QtyField sku={handout.sku} label="Moving" value={qty} onChange={setQty} />
        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {move.isError && <p className="text-sm text-danger">{move.error.message}</p>}
      </div>
    </Modal>
  );
}
