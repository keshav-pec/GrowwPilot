import { useState } from 'react';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { useAutomation, useDismissException, usePostException, useRetryEvent } from '../../../api/inventory/automation';
import { EXCEPTION_REASON_LABEL, formatQty, newRequestKey } from '../../../lib/inventory';
import { Badge, Button, Card, Input, Modal } from '../../../components/ui';

// Services that couldn't take their stock automatically (nothing went below zero), and events that failed.
// After restocking, Post now takes what the recipe said at the time. Owners can dismiss with a reason.
export default function AutomationCard({ can }) {
  const automationQuery = useAutomation();
  const postException = usePostException();
  const retryEvent = useRetryEvent();
  const [dismissing, setDismissing] = useState(null);
  const { exceptions = [], failedEvents = [] } = automationQuery.data ?? {};
  if (exceptions.length + failedEvents.length === 0) return null;

  function post(e) {
    postException.mutate(
      { key: newRequestKey(), id: e._id },
      { onSuccess: () => toast.success(`${e.skuName} taken for ${e.serviceName}`), onError: (err) => toast.error(err.message) }
    );
  }

  function retry(e) {
    retryEvent.mutate({ id: e._id }, { onSuccess: () => toast.success('Trying again'), onError: (err) => toast.error(err.message) });
  }

  return (
    <Card title={`Services that couldn’t take their stock (${exceptions.length + failedEvents.length})`} className="border-orange/50">
      <ul className="divide-y divide-border text-sm">
        {exceptions.map((e) => (
          <li key={e._id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-medium">
                {e.serviceName} ({e.staffName}) needed {e.sku ? formatQty(e.qty, e.sku) : e.qty} of {e.skuName}{' '}
                <Badge tone="orange">{EXCEPTION_REASON_LABEL[e.reason]}</Badge>
              </p>
              <p className="text-xs text-muted">
                {e.customerName && `${e.customerName} · `}
                {DateTime.fromISO(e.completedAt).toRelative()} · {e.message}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => post(e)} loading={postException.isPending && postException.variables?.id === e._id}>
                Post now
              </Button>
              {can['inventory.dismissExceptions'] && (
                <Button size="sm" variant="ghost" onClick={() => setDismissing(e)}>
                  Dismiss
                </Button>
              )}
            </div>
          </li>
        ))}
        {failedEvents.map((e) => (
          <li key={e._id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div>
              <p className="font-medium">
                A completed visit{e.customerName && ` (${e.customerName})`} couldn’t be handled <Badge tone="danger">Failed</Badge>
              </p>
              <p className="text-xs text-muted">
                {DateTime.fromISO(e.completedAt).toRelative()} · {e.lastError}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => retry(e)} loading={retryEvent.isPending && retryEvent.variables?.id === e._id}>
              Retry
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Restock first, then press Post now. Trying again never takes stock twice.</p>
      {dismissing && <DismissModal exception={dismissing} onClose={() => setDismissing(null)} />}
    </Card>
  );
}

function DismissModal({ exception, onClose }) {
  const dismiss = useDismissException();
  const [key] = useState(newRequestKey);
  const [note, setNote] = useState('');

  function save() {
    dismiss.mutate(
      { key, id: exception._id, note },
      {
        onSuccess: () => {
          toast.success('Dismissed');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Don’t take ${exception.skuName} for this ${exception.serviceName}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={dismiss.isPending} disabled={note.trim().length < 3}>
            Dismiss
          </Button>
        </>
      }
    >
      <Input id="dismiss-reason" label="Why" autoFocus placeholder="e.g. Used a sample instead" value={note} onChange={(e) => setNote(e.target.value)} />
      {dismiss.isError && <p className="mt-2 text-sm text-danger">{dismiss.error.message}</p>}
    </Modal>
  );
}
