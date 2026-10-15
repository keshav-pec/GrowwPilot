import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../auth/AuthContext';
import { useLocations } from '../../../api/inventory/locations';
import { useIssue } from '../../../api/inventory/allocations';
import { formatQty, isMeasured, newRequestKey, recipientFromValue, rememberChoice, rememberedChoice } from '../../../lib/inventory';
import { Button, Modal } from '../../../components/ui';
import { ProductPicker, QtyField, RecipientSelect, StoreSelect } from './fields';

// Issue product (INV-05): a product, the store, who gets it and how many. The store and the person
// are remembered for next time.
export default function IssueModal({ sku: presetSku, onClose }) {
  const { activeBranchId } = useAuth();
  const issueStock = useIssue();
  const locations = useLocations().data ?? [];
  const remembered = rememberedChoice(activeBranchId);
  const [key] = useState(newRequestKey);
  const [sku, setSku] = useState(presetSku ?? null);
  const [storeId, setStoreId] = useState(remembered.storeId);
  const [recipient, setRecipient] = useState(remembered.recipient ?? '');
  const [qty, setQty] = useState(presetSku && isMeasured(presetSku) ? presetSku.unitsPerStockUnit : 1);

  // A remembered store that was closed falls back to the main store
  const openStores = locations.filter((l) => l.kind === 'STORE' && l.active);
  const store = openStores.find((l) => l._id === storeId) ?? openStores.find((l) => l.isMain);

  function pick(row) {
    setSku(row);
    setQty(isMeasured(row) ? row.unitsPerStockUnit : 1);
  }

  function save() {
    issueStock.mutate(
      { key, skuId: sku._id, locationId: store._id, recipient: recipientFromValue(recipient), qty },
      {
        onSuccess: ({ allocation }) => {
          rememberChoice(activeBranchId, { storeId: store._id, recipient });
          toast.success(`Issued ${formatQty(qty, sku)} of ${sku.name} to ${allocation.recipient.name}`);
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={sku ? `Issue ${sku.name}` : 'Issue product'}
      footer={
        sku && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={issueStock.isPending} disabled={!recipient || !store || qty < 1}>
              Issue
            </Button>
          </>
        )
      }
    >
      {!sku ? (
        <ProductPicker onPick={pick} onlyInStore />
      ) : (
        <div className="flex flex-col gap-4">
          {!presetSku && (
            <button type="button" className="self-start text-sm text-brown underline" onClick={() => setSku(null)}>
              ← Choose another product
            </button>
          )}
          <StoreSelect label="From" value={store?._id} onChange={setStoreId} />
          <RecipientSelect value={recipient} onChange={setRecipient} />
          <QtyField sku={sku} value={qty} onChange={setQty} />
          <p className="text-xs text-muted">It moves from the store to In use. It’s used up only when someone marks it finished.</p>
          {issueStock.isError && <p className="text-sm text-danger">{issueStock.error.message}</p>}
        </div>
      )}
    </Modal>
  );
}
