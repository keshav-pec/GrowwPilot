import { useState } from 'react';
import toast from 'react-hot-toast';
import { Info } from 'lucide-react';
import { useConsentHistory, useConsents, useRemoveOccasionData } from '../../api/occasions';
import { newRequestKey } from '../../lib/billing';
import { CHANNEL_LABEL, CONSENT_SOURCE_LABEL, CONSENT_STATUS } from '../../lib/occasions';
import { formatDateTime } from '../../lib/time';
import { Badge, Button, Card, EmptyState, Spinner, Table } from '../../components/ui';
import ReasonModal from '../billing/ReasonModal';
import ConsentModal from './ConsentModal';

// Customer profile → Messages & permission: one row per channel, recording and withdrawing permission,
// the history of every change (it can't be edited), and "Remove occasion data" for the business owner.
export default function MessagesPermissionTab({ customer, zone }) {
  const consentsQuery = useConsents(customer._id);
  const historyQuery = useConsentHistory(customer._id);
  const removeData = useRemoveOccasionData(customer._id);
  const [action, setAction] = useState(null); // { channel, mode: 'record' | 'withdraw' }
  const [removing, setRemoving] = useState(false);
  const [removeKey, setRemoveKey] = useState(newRequestKey);

  if (consentsQuery.isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (consentsQuery.isError) return <EmptyState title="Couldn’t load messaging permission" message={consentsQuery.error.message} />;
  const { channels, wording, noticeVersion, can } = consentsQuery.data;

  function how(c) {
    if (c.status === 'UNKNOWN' || !c.changedAt) return '—';
    const parts = [CONSENT_SOURCE_LABEL[c.source], formatDateTime(c.changedAt, zone), c.changedByName && `by ${c.changedByName}`, c.status === 'OPTED_IN' && c.noticeVersion && `wording ${c.noticeVersion}`];
    return (
      <span>
        {parts.filter(Boolean).join(' · ')}
        {c.evidence && <span className="block text-xs text-muted">{c.evidence}</span>}
      </span>
    );
  }

  function actions(c) {
    if (!c.available) return <span className="text-xs text-muted">Add an email address first</span>;
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {c.status !== 'OPTED_IN' && can.record && (
          <Button size="sm" variant="secondary" onClick={() => setAction({ channel: c.channel, mode: 'record' })}>
            Record permission
          </Button>
        )}
        {c.status !== 'OPTED_OUT' && can.withdraw && (
          <Button size="sm" variant="ghost" onClick={() => setAction({ channel: c.channel, mode: 'withdraw' })}>
            {c.status === 'OPTED_IN' ? 'Withdraw' : 'Mark opted out'}
          </Button>
        )}
      </div>
    );
  }

  const columns = [
    { key: 'channel', header: 'Channel', render: (c) => CHANNEL_LABEL[c.channel] },
    { key: 'status', header: 'Permission', render: (c) => <Badge tone={CONSENT_STATUS[c.status].tone}>{CONSENT_STATUS[c.status].label}</Badge> },
    { key: 'how', header: 'How and when', render: how },
    { key: 'actions', header: '', render: actions },
  ];

  const historyColumns = [
    { key: 'when', header: 'When', render: (e) => formatDateTime(e.createdAt, zone) },
    { key: 'channel', header: 'Channel', render: (e) => CHANNEL_LABEL[e.channel] },
    { key: 'change', header: 'Change', render: (e) => `${CONSENT_STATUS[e.from].label} → ${CONSENT_STATUS[e.to].label}` },
    { key: 'source', header: 'How', render: (e) => [CONSENT_SOURCE_LABEL[e.source], e.customerAsked && 'customer asked', e.noticeVersion && `wording ${e.noticeVersion}`].filter(Boolean).join(' · ') },
    { key: 'by', header: 'By', render: (e) => `${e.actorName} (${e.actorRole})` },
    { key: 'note', header: 'Note', render: (e) => e.note || '—' },
  ];

  function confirmRemove(reason) {
    removeData.mutate(
      { key: removeKey, reason },
      {
        onSuccess: () => {
          toast.success('Occasion data removed');
          setRemoving(false);
          setRemoveKey(newRequestKey());
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg bg-surface p-3 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0" />
        An occasion offer may still be used in the salon even when messaging permission is absent. “Not recorded” counts as no.
      </p>

      <Table columns={columns} rows={channels} rowKey="channel" />

      <Card title="History">
        {historyQuery.isPending ? (
          <Spinner />
        ) : (
          <Table columns={historyColumns} rows={historyQuery.data ?? []} empty={<EmptyState title="No changes yet" message="Every change to messaging permission is listed here and can’t be edited." />} />
        )}
      </Card>

      {can.removeData && (
        <Card title="Remove occasion data">
          <p className="mb-3 text-sm text-muted">Clears {customer.name}’s birthday and anniversary and opts them out of every channel. Use this when the customer asks you to delete this information.</p>
          <Button variant="danger" onClick={() => setRemoving(true)}>
            Remove occasion data
          </Button>
        </Card>
      )}

      {action && (
        <ConsentModal
          customerId={customer._id}
          customerName={customer.name}
          channel={action.channel}
          mode={action.mode}
          wording={wording[action.channel]}
          noticeVersion={noticeVersion}
          mustConfirmCustomerAsked={can.mustConfirmCustomerAsked}
          onClose={() => setAction(null)}
        />
      )}
      {removing && (
        <ReasonModal
          title="Remove occasion data"
          message={`${customer.name}’s birthday and anniversary will be cleared and every channel set to “Opted out”. This can’t be undone.`}
          confirmLabel="Remove"
          loading={removeData.isPending}
          onClose={() => setRemoving(false)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  );
}
