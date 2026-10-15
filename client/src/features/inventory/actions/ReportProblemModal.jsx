import { useState } from 'react';
import toast from 'react-hot-toast';
import { useReportProblem } from '../../../api/inventory/requests';
import { REPORT_REASONS, isMeasured, newRequestKey } from '../../../lib/inventory';
import { Button, Input, Modal, Select, Textarea } from '../../../components/ui';
import { ProductPicker } from './fields';

// The front desk can't change stock by hand; they report what happened, and an owner or the inventory login deals with it
export default function ReportProblemModal({ sku: presetSku, handout, onClose }) {
  const report = useReportProblem();
  const [key] = useState(newRequestKey);
  const [sku, setSku] = useState(presetSku ?? handout?.sku ?? null);
  const [reason, setReason] = useState('DAMAGE');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');

  function save() {
    report.mutate(
      { key, skuId: sku._id, allocationId: handout?._id, reason, qty: qty ? Number(qty) : undefined, note },
      {
        onSuccess: () => {
          toast.success('Reported. The owner and the inventory team have been told.');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={sku ? `Report a problem: ${sku.name}` : 'Report a problem'}
      footer={
        sku && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={report.isPending} disabled={note.trim().length < 3 || (qty !== '' && !/^\d+$/.test(qty))}>
              Send report
            </Button>
          </>
        )
      }
    >
      {!sku ? (
        <ProductPicker onPick={setSku} />
      ) : (
        <div className="flex flex-col gap-4">
          {handout && <p className="text-sm text-muted">About what {handout.recipient.name} has.</p>}
          <Select label="What happened" options={REPORT_REASONS} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input label={`How many ${isMeasured(sku) ? sku.baseUnit : `${sku.stockUnit}s`} (optional)`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Textarea label="Details" placeholder="e.g. Bottle fell and cracked at Chair 2" value={note} onChange={(e) => setNote(e.target.value)} />
          {report.isError && <p className="text-sm text-danger">{report.error.message}</p>}
        </div>
      )}
    </Modal>
  );
}
