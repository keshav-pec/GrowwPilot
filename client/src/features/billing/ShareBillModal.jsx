import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, MessageCircle } from 'lucide-react';
import { useShareInvoice } from '../../api/invoices';
import { formatMoney } from '../../lib/money';
import { Button, Input, Modal, Spinner } from '../../components/ui';

// A link the customer can open without logging in (the bill as a PDF, phone number partly hidden).
// Copy it, or open WhatsApp with a ready message to the customer's number.
export default function ShareBillModal({ invoice, salonName, onClose }) {
  const share = useShareInvoice();
  const [link, setLink] = useState('');
  const asked = useRef(false);

  // Make the link once, when the window opens (React may run this twice while developing)
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    share.mutate(invoice._id, {
      onSuccess: ({ token }) => setLink(`${window.location.origin}/api/public/bills/${token}.pdf`),
      onError: (err) => toast.error(err.message),
    });
  }, [invoice._id, share]);

  const phone = invoice.customerSnapshot?.phone;
  const message = `Hi ${invoice.customerSnapshot?.name ?? ''}, here is your bill ${invoice.invoiceNumber} from ${salonName} (${formatMoney(invoice.grandTotal)}): ${link}`;
  const whatsapp = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn’t copy. Select the link and copy it.');
    }
  }

  return (
    <Modal open onClose={onClose} title="Send the bill to the customer">
      {!link ? (
        <div className="flex justify-center py-6">{share.isError ? <p className="text-sm text-danger">{share.error.message}</p> : <Spinner />}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Bill link" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={copy}>
              <Copy size={16} /> Copy link
            </Button>
            <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-dark">
              <MessageCircle size={16} /> Send on WhatsApp
            </a>
          </div>
          <p className="text-xs text-muted">Anyone with this link can open this one bill for 30 days. The phone number on it is partly hidden.</p>
        </div>
      )}
    </Modal>
  );
}
