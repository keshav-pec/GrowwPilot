import { useState } from 'react';
import toast from 'react-hot-toast';
import { useSendOffer, useSendPreview } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { CHANNEL_LABEL } from '../../../lib/occasions';
import { Button, Modal, Spinner } from '../../../components/ui';
import OfferNotice from './OfferNotice';

// Send offer: the channel (first allowed in the salon's order), the recipient and the finished message.
// "Confirm send" checks everything again on the server. WhatsApp / SMS (and email when email isn't set up): opens
// that app with the message filled in, and staff press send there. Email (set up): the app sends it itself.
// Either way the task is marked contacted.
export default function SendOfferModal({ offerId, customerName, zone, onClose }) {
  const [channel, setChannel] = useState(null);
  const previewQuery = useSendPreview(offerId, channel);
  const send = useSendOffer();
  const [key] = useState(newRequestKey);
  const p = previewQuery.data;

  function confirm() {
    if (p.appSends) {
      send.mutate(
        { key, offerId, channel: p.channel },
        {
          onSuccess: (result) => {
            toast.success(`Email is on its way to ${result.to}`);
            onClose();
          },
          onError: (err) => toast.error(err.message),
        }
      );
      return;
    }
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
              {p.appSends ? 'Send email' : 'Confirm send'}
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
          {p.appSends && <p className="text-xs text-muted">The app sends this email for you, with an unsubscribe link at the bottom. If it can’t be sent, you’ll see why here and in your bell, and you can send it again.</p>}
          <p className="text-xs text-muted">Only one offer message per customer every 7 days. This one counts as soon as you confirm.</p>
        </div>
      )}
    </Modal>
  );
}
