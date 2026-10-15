import { useState } from 'react';
import toast from 'react-hot-toast';
import { useWriteOff } from '../../../api/inventory/movements';
import { useLocations } from '../../../api/inventory/locations';
import { WRITE_OFF_REASONS, formatQty, isMeasured, newRequestKey } from '../../../lib/inventory';
import { Button, Input, Modal, Select } from '../../../components/ui';
import { ProductPicker, QtyField, StoreSelect } from './fields';

// Use / write off / adjust stock (INV-08): a product, where it is (a store or a hand-out), how many and why.
// Within your limit it is saved at once; above it, add a note and it waits for an owner.
// `report`: a problem the front desk reported, closed by this write-off.
export default function WriteOffModal({ sku: presetSku, handout, report, onClose }) {
  const writeOff = useWriteOff();
  const locations = useLocations().data ?? [];
  const [key] = useState(newRequestKey);
  const [sku, setSku] = useState(presetSku ?? handout?.sku ?? report?.sku ?? null);
  const [storeId, setStoreId] = useState(report?.locationId ?? null);
  const [reason, setReason] = useState(report?.reason && report.reason !== 'OTHER' ? report.reason : 'DAMAGE');
  const [direction, setDirection] = useState('REMOVE');
  const [qty, setQty] = useState(report?.qty ?? (handout ? handout.remainingQty : 1));
  const [note, setNote] = useState(report ? `Reported by ${report.requestedBy.name}: ${report.note}` : '');

  const fromHandout = handout ?? null;
  const store = locations.find((l) => l._id === storeId) ?? locations.find((l) => l.isMain);
  const isCount = reason === 'STOCK_COUNT_CORRECTION';
  const reasons = fromHandout ? WRITE_OFF_REASONS.filter((r) => r.value !== 'STOCK_COUNT_CORRECTION') : WRITE_OFF_REASONS;

  function pick(row) {
    setSku(row);
    setQty(isMeasured(row) ? row.unitsPerStockUnit : 1);
  }

  function save() {
    const where = fromHandout ? { allocationId: fromHandout._id } : { locationId: store._id };
    writeOff.mutate(
      { key, skuId: sku._id, ...where, qty, reason, direction: isCount ? direction : 'REMOVE', note: note.trim() || undefined, reportId: report?._id },
      {
        onSuccess: (result) => {
          if (result.status === 'PENDING_APPROVAL') toast('Above your limit, so it was sent to an owner for approval', { icon: '⏳', duration: 6000 });
          else toast.success('Saved');
          onClose();
        },
      }
    );
  }

  const noteNeeded = writeOff.error?.code === 'NOTE_REQUIRED';

  return (
    <Modal
      open
      onClose={onClose}
      title={sku ? `Use or write off: ${sku.name}` : 'Use or write off stock'}
      footer={
        sku && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={writeOff.isPending} disabled={qty < 1 || (fromHandout && qty > fromHandout.remainingQty)}>
              Save
            </Button>
          </>
        )
      }
    >
      {!sku ? (
        <ProductPicker onPick={pick} />
      ) : (
        <div className="flex flex-col gap-4">
          {fromHandout ? (
            <p className="text-sm text-muted">
              From what {fromHandout.recipient.name} has ({formatQty(fromHandout.remainingQty, sku)}). A lost bottle is “Lost”, not finished.
            </p>
          ) : (
            <StoreSelect label="Where" value={store?._id} onChange={setStoreId} />
          )}
          <Select label="What happened" options={reasons} value={reason} onChange={(e) => setReason(e.target.value)} />
          {isCount && (
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-gold" checked={direction === 'REMOVE'} onChange={() => setDirection('REMOVE')} /> There is less than recorded
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-gold" checked={direction === 'ADD'} onChange={() => setDirection('ADD')} /> We found more
              </label>
            </div>
          )}
          <QtyField sku={sku} value={qty} onChange={setQty} />
          <Input
            label={noteNeeded ? 'Note (needed)' : 'Note (optional)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={noteNeeded ? 'This is above your limit. Say what happened; an owner will approve it.' : undefined}
          />
          {writeOff.isError && !noteNeeded && <p className="text-sm text-danger">{writeOff.error.message}</p>}
        </div>
      )}
    </Modal>
  );
}
