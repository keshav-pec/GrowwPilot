import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRecordContact } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { CALL_OUTCOMES } from '../../../lib/occasions';
import { fromLocalInput, toLocalInput } from '../../../lib/time';
import { Button, Input, Modal, Textarea } from '../../../components/ui';

// Record call outcome. A call never counts as an offer message and never needs messaging permission.
// onWrongDetails: called after "Wrong details", so the screen can point to the profile to fix the number.
export default function RecordOutcomeModal({ offer, zone, onClose, onWrongDetails }) {
  const record = useRecordContact();
  const [key] = useState(newRequestKey);
  const [outcome, setOutcome] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [note, setNote] = useState('');
  const withdrawnNotice = offer.task?.kind === 'WITHDRAWN_NOTICE';
  const outcomes = withdrawnNotice ? CALL_OUTCOMES.filter((o) => ['REACHED', 'NO_ANSWER', 'WRONG_DETAILS'].includes(o.value)) : CALL_OUTCOMES;
  const ready = outcome && (outcome !== 'CALL_LATER' || callbackAt);

  function save() {
    record.mutate(
      { key, offerId: offer._id, outcome, note: note.trim() || undefined, callbackAt: outcome === 'CALL_LATER' ? fromLocalInput(callbackAt, zone) : undefined },
      {
        onSuccess: (result) => {
          toast.success('Call recorded');
          if (result.fixDetails) onWrongDetails?.();
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
      title={withdrawnNotice ? 'Record call: offer withdrawn' : 'Record call outcome'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={record.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          {outcomes.map((o) => (
            <label key={o.value} className={`flex items-start gap-2 rounded-lg border p-3 ${outcome === o.value ? 'border-gold bg-gold/10' : 'border-border'}`}>
              <input type="radio" className="mt-1 accent-gold" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{withdrawnNotice && o.value === 'REACHED' ? 'Told them the offer was withdrawn' : o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {outcome === 'CALL_LATER' && (
          <Input
            label="Call back at"
            type="datetime-local"
            value={callbackAt}
            min={toLocalInput(new Date().toISOString(), zone)}
            max={toLocalInput(offer.validUntil, zone)}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
        )}
        <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
