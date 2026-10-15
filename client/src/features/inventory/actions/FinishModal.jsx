import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../auth/AuthContext';
import { useFinish, useHandouts } from '../../../api/inventory/allocations';
import { useLocations } from '../../../api/inventory/locations';
import { formatQty, isMeasured, newRequestKey, recipientFromValue, recipientValue, rememberedChoice } from '../../../lib/inventory';
import { Button, Input, Modal, Spinner } from '../../../components/ui';
import { QtyField, RecipientSelect, StoreSelect } from './fields';

// Finish & replace (INV-07) in one step: mark what is used up and, if ticked, hand out a new one.
// The finish is always saved; if the store has nothing left to replace it, you are told and it shows on Need to order.
export default function FinishModal({ handout: presetHandout, canReplace, onClose }) {
  const [handout, setHandout] = useState(presetHandout ?? null);
  return (
    <Modal open onClose={onClose} title={handout ? `Finished: ${handout.sku.name}` : 'Mark finished'}>
      {handout ? <FinishForm handout={handout} canReplace={canReplace} onBack={presetHandout ? null : () => setHandout(null)} onClose={onClose} /> : <HandoutChooser onPick={setHandout} />}
    </Modal>
  );
}

// Which hand-out? Search by product or by who has it
function HandoutChooser({ onPick }) {
  const handoutsQuery = useHandouts();
  const [search, setSearch] = useState('');
  if (handoutsQuery.isPending) return <Spinner size={20} />;
  const words = search.trim().toLowerCase();
  const rows = (handoutsQuery.data ?? []).filter((h) => !words || `${h.sku.name} ${h.recipient.name}`.toLowerCase().includes(words));

  return (
    <div className="flex flex-col gap-3">
      <Input label="Product or person" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. shampoo, Rahul, Chair 3" />
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-muted">Nothing handed out matches.</li>
        ) : (
          rows.map((h) => (
            <li key={h._id}>
              <button type="button" onClick={() => onPick(h)} className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-yellow-soft">
                <span>
                  <span className="font-medium">{h.sku.name}</span> · {h.recipient.name}
                </span>
                <span className="whitespace-nowrap text-muted">{formatQty(h.remainingQty, h.sku)}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function FinishForm({ handout, canReplace, onBack, onClose }) {
  const { activeBranchId } = useAuth();
  const finish = useFinish();
  const locations = useLocations().data ?? [];
  const { sku } = handout;
  const measured = isMeasured(sku);
  const [key] = useState(newRequestKey);
  // Whole bottles: 1 at a time. Measured: whatever is left.
  const [qty, setQty] = useState(measured ? handout.remainingQty : Math.min(1, handout.remainingQty));
  const [replace, setReplace] = useState(canReplace && handout.usuallyReplaced);
  const [replaceQty, setReplaceQty] = useState(measured ? sku.unitsPerStockUnit : 1);
  const [storeId, setStoreId] = useState(rememberedChoice(activeBranchId).storeId);
  const [recipient, setRecipient] = useState(recipientValue(handout.recipient));
  const [note, setNote] = useState('');

  const openStores = locations.filter((l) => l.kind === 'STORE' && l.active);
  const store = openStores.find((l) => l._id === storeId) ?? openStores.find((l) => l.isMain);

  function save() {
    const replacement = replace ? { qty: replaceQty, locationId: store?._id, recipient: recipientFromValue(recipient) } : undefined;
    finish.mutate(
      { key, id: handout._id, qty, note: note || undefined, replacement },
      {
        onSuccess: (result) => {
          if (result.replacement.status === 'ISSUED') toast.success('Finished, and a new one was issued');
          else if (result.replacement.status === 'UNAVAILABLE') toast(`Finished. There’s none left in the store to replace it, so it’s on Need to order.`, { icon: '⚠️', duration: 6000 });
          else toast.success('Marked finished');
          onClose();
        },
      }
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {onBack && (
        <button type="button" className="self-start text-sm text-brown underline" onClick={onBack}>
          ← Choose another
        </button>
      )}
      <p className="text-sm text-muted">
        {handout.recipient.name} has {formatQty(handout.remainingQty, sku)}.
      </p>
      <QtyField sku={sku} label="Finished" value={qty} onChange={setQty} error={qty > handout.remainingQty ? `Only ${formatQty(handout.remainingQty, sku)} left` : undefined} />

      {canReplace && (
        <div className="rounded-lg bg-surface p-3">
          <label className="mb-3 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="accent-gold" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Issue a replacement
          </label>
          {replace && (
            <div className="flex flex-col gap-3">
              <QtyField sku={sku} label="New" value={replaceQty} onChange={setReplaceQty} />
              <div className="grid gap-3 sm:grid-cols-2">
                <StoreSelect label="From" value={store?._id} onChange={setStoreId} />
                <RecipientSelect label="To" value={recipient} onChange={setRecipient} />
              </div>
            </div>
          )}
        </div>
      )}

      <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {finish.isError && <p className="text-sm text-danger">{finish.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} loading={finish.isPending} disabled={qty < 1 || qty > handout.remainingQty || (replace && replaceQty < 1)}>
          {replace ? 'Finish & replace' : 'Mark finished'}
        </Button>
      </div>
    </div>
  );
}
