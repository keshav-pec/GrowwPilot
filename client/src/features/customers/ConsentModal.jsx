import { useState } from 'react';
import toast from 'react-hot-toast';
import { useChangeConsent } from '../../api/occasions';
import { newRequestKey } from '../../lib/billing';
import { CHANNEL_LABEL, CONSENT_SOURCES } from '../../lib/occasions';
import { Button, Modal, Select, Textarea } from '../../components/ui';

// Record permission (mode 'record') or an opt-out (mode 'withdraw') for one channel.
// Recording: the tick box starts unticked and shows the exact wording; the front desk also ticks
// "Customer asked for this". Withdrawing works straight away.
export default function ConsentModal({ customerId, customerName, channel, mode, wording, noticeVersion, mustConfirmCustomerAsked, onClose }) {
  const change = useChangeConsent(customerId);
  const [key] = useState(newRequestKey);
  const [agreed, setAgreed] = useState(false);
  const [customerAsked, setCustomerAsked] = useState(false);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const recording = mode === 'record';
  const label = CHANNEL_LABEL[channel];
  const ready = source && (!recording || (agreed && (!mustConfirmCustomerAsked || customerAsked)));

  function save() {
    change.mutate(
      { key, channel, status: recording ? 'OPTED_IN' : 'OPTED_OUT', source, agreed, customerAsked, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(recording ? `${label} permission recorded` : `${customerName} opted out of ${label}`);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={recording ? `Record ${label} permission` : `Opt out of ${label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={recording ? 'primary' : 'danger'} disabled={!ready} loading={change.isPending} onClick={save}>
            {recording ? 'Record permission' : 'Opt out'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {recording ? (
          <label className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3">
            <input type="checkbox" className="mt-1 accent-gold" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              “{wording}”
              <span className="mt-1 block text-xs text-muted">Wording {noticeVersion}. Read it to the customer or show it to them, then tick.</span>
            </span>
          </label>
        ) : (
          <p className="text-muted">{customerName} will not get offer messages on {label} from now on. You can record permission again later if they ask.</p>
        )}
        <Select label={recording ? 'How was it given?' : 'How did they tell you?'} placeholder="Choose" options={CONSENT_SOURCES} value={source} onChange={(e) => setSource(e.target.value)} />
        {recording && mustConfirmCustomerAsked && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-gold" checked={customerAsked} onChange={(e) => setCustomerAsked(e.target.checked)} />
            Customer asked for this
          </label>
        )}
        <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={recording ? 'e.g. Asked at the counter after her facial' : 'e.g. Called to say stop'} />
      </div>
    </Modal>
  );
}
