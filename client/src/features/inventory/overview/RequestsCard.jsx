import { useState } from 'react';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { useDecideRequest, useDismissReport, useRequests } from '../../../api/inventory/requests';
import { REASON_LABEL, formatQty, newRequestKey } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { Badge, Button, Card, Input, Modal } from '../../../components/ui';
import WriteOffModal from '../actions/WriteOffModal';

const STATUS = { PENDING: ['Waiting', 'gold'], RESOLVED: ['Dealt with', 'brown'], DISMISSED: ['Closed', 'neutral'] };

// Owners and inventory logins: write-offs waiting for approval and problems the front desk reported.
// The front desk: the problems they reported, and what happened to them.
export default function RequestsCard({ handlesRequests }) {
  const requestsQuery = useRequests();
  const decide = useDecideRequest();
  const [writingOff, setWritingOff] = useState(null); // a problem report
  const [dismissing, setDismissing] = useState(null);
  const requests = requestsQuery.data ?? [];
  if (requests.length === 0) return null;

  function decideRequest(r, approve) {
    decide.mutate(
      { key: newRequestKey(), id: r._id, approve },
      { onSuccess: () => toast.success(approve ? 'Approved and written off' : 'Turned down'), onError: (err) => toast.error(err.message) }
    );
  }

  return (
    <Card title={handlesRequests ? `Waiting for you (${requests.length})` : 'Your reports'} className="border-gold/60">
      <ul className="divide-y divide-border text-sm">
        {requests.map((r) => (
          <li key={r._id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-medium">
                {r.kind === 'WRITE_OFF' ? 'Write-off to approve' : 'Problem reported'}: {r.qty ? `${formatQty(r.qty, r.sku)} of ` : ''}
                {r.skuName} ({REASON_LABEL[r.reason]})
                {r.value != null && ` · ${formatAmount(r.value)}`}
              </p>
              <p className="text-xs text-muted">
                {r.requestedBy.name} · {DateTime.fromISO(r.createdAt).toRelative()}
                {r.note && ` · “${r.note}”`}
              </p>
              {!handlesRequests && r.decisionNote && <p className="text-xs text-ink">{r.decidedBy?.name}: {r.decisionNote}</p>}
            </div>
            {handlesRequests ? (
              r.canDecide ? (
                <div className="flex gap-1">
                  {r.kind === 'WRITE_OFF' ? (
                    <>
                      <Button size="sm" onClick={() => decideRequest(r, true)} loading={decide.isPending && decide.variables?.id === r._id}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decideRequest(r, false)}>
                        Turn down
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setWritingOff(r)}>
                        Write off
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDismissing(r)}>
                        Close
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted">Above your limit: the business owner decides</span>
              )
            ) : (
              <Badge tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</Badge>
            )}
          </li>
        ))}
      </ul>

      {writingOff && <WriteOffModal report={writingOff} onClose={() => setWritingOff(null)} />}
      {dismissing && <DismissModal report={dismissing} onClose={() => setDismissing(null)} />}
    </Card>
  );
}

// Close a reported problem without writing anything off, saying why
function DismissModal({ report, onClose }) {
  const dismiss = useDismissReport();
  const [key] = useState(newRequestKey);
  const [note, setNote] = useState('');

  return (
    <Modal
      open
      onClose={onClose}
      title={`Close ${report.requestedBy.name}’s report`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={dismiss.isPending}
            disabled={note.trim().length < 3}
            onClick={() =>
              dismiss.mutate(
                { key, id: report._id, note },
                {
                  onSuccess: () => {
                    toast.success('Closed');
                    onClose();
                  },
                }
              )
            }
          >
            Close report
          </Button>
        </>
      }
    >
      <Input id="dismiss-note" label="Why (they’ll see this)" autoFocus placeholder="e.g. Found it in the back room" value={note} onChange={(e) => setNote(e.target.value)} />
      {dismiss.isError && <p className="mt-2 text-sm text-danger">{dismiss.error.message}</p>}
    </Modal>
  );
}
