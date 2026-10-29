import { useState } from 'react';
import toast from 'react-hot-toast';
import { useSendOffer, useSendPreview } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { CHANNEL_LABEL } from '../../../lib/occasions';
import { Button, Modal, Spinner } from '../../../components/ui';
import OfferNotice from './OfferNotice';

// Send offer: the channel (first allowed in the salon's order), the recipient and the finished message.
// "Confirm send" checks everything again on the server, then opens WhatsApp / SMS / email with the message
// filled in. Staff press send in that app; the task is marked contacted.
export default function SendOfferModal({ offerId, customerName, zone, onClose }) {
  const [channel, setChannel] = useState(null);
  const previewQuery = useSendPreview(offerId, channel);
  const send = useSendOffer();
  const [key] = useState(newRequestKey);
  const p = previewQuery.data;

  function confirm() {
    // Open the WhatsApp tab straight from the click, so the browser doesn't block it; fill it once the server says yes
    const tab = p.channel === 'WHATSAPP' ? window.open('', '_blank') : null;
    send.mutate(
      { key, offerId, channel: p.channel },
      {
        onSuccess: (result) => {
          if (tab) tab.location.href = result.link;
          else window.location.href = result.link; // sms: and mailto: open the phone's own app
          toast.success(`Contacted via ${CHANNEL_LABEL[result.channel]}`);
          onClose();
        },
        onError: (err) => {
          tab?.close();
          toast.error(err.message);
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Send offer to ${customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {p?.allowed && (
            <Button onClick={confirm} loading={send.isPending}>
              Confirm send
            </Button>
          )}
        </>
      }
    >
      {previewQuery.isPending ? (
        <Spinner />
      ) : previewQuery.isError ? (
        <p className="text-sm text-danger">{previewQuery.error.message}</p>
      ) : !p.allowed ? (
        <OfferNotice notice={p} zone={zone} />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          {p.channels.length > 1 && (
            <div className="flex flex-wrap gap-3">
              {p.channels.map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <input type="radio" className="accent-gold" checked={p.channel === c} onChange={() => setChannel(c)} />
                  {CHANNEL_LABEL[c]}
                </label>
              ))}
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Channel</dt>
            <dd>{CHANNEL_LABEL[p.channel]}</dd>
            <dt className="text-muted">To</dt>
            <dd>{p.to}</dd>
            {p.subject && (
              <>
                <dt className="text-muted">Subject</dt>
                <dd>{p.subject}</dd>
              </>
            )}
          </dl>
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-3">{p.body}</p>
          <p className="text-xs text-muted">Only one offer message per customer every 7 days. This one counts as soon as you confirm.</p>
        </div>
      )}
    </Modal>
  );
}
