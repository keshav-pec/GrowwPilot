import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAnswerPayRequest } from '../../api/payroll';
import { describePay, formatPayDay } from '../../lib/payroll';
import { formatDateTime } from '../../lib/time';
import { Badge, Button, Modal, Textarea } from '../../components/ui';

const STATUS = {
  pending: { label: 'Waiting for approval', tone: 'yellow' },
  approved: { label: 'Approved', tone: 'brown' },
  rejected: { label: 'Not approved', tone: 'danger' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};

// Approve or reject, with an optional note for the front desk
function AnswerModal({ request, action, onClose }) {
  const answer = useAnswerPayRequest();
  const [note, setNote] = useState('');
  const approving = action === 'approve';

  function submit() {
    answer.mutate(
      { id: request._id, action, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(approving ? `${request.staffName}'s new pay is saved` : 'Request not approved');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={approving ? 'Approve this pay change?' : 'Don’t approve this pay change?'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={approving ? 'primary' : 'danger'} onClick={submit} loading={answer.isPending}>
            {approving ? 'Approve' : 'Don’t approve'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          {request.staffName}: <span className="font-medium">{describePay(request.proposed)}</span> from {formatPayDay(request.proposed.effectiveFrom)}
        </p>
        <Textarea label={approving ? 'Note (optional)' : 'Reason (optional, shown to the front desk)'} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {answer.isError && <p className="text-danger">{answer.error.message}</p>}
      </div>
    </Modal>
  );
}

// One pay change request: what's asked, why, by whom, and the answer
export default function PayRequestCard({ request, showBranch = false }) {
  const { user, activeBranch } = useAuth();
  const answer = useAnswerPayRequest();
  const [answering, setAnswering] = useState(null); // 'approve' | 'reject'
  const status = STATUS[request.status];
  const zone = activeBranch?.timezone;
  const isMine = request.requestedBy === user._id;

  function withdraw() {
    answer.mutate({ id: request._id, action: 'cancel' }, { onSuccess: () => toast.success('Request withdrawn'), onError: (err) => toast.error(err.message) });
  }

  return (
    <div className="rounded-xl border border-border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">
          {request.staffName}
          {showBranch && request.branchId?.name && <span className="font-normal text-muted"> · {request.branchId.name}</span>}
        </p>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted">{request.currentSummary === 'No pay setup' ? 'Not set up yet' : request.currentSummary}</span>
        <ArrowRight size={14} className="text-muted" />
        <span className="font-medium">{describePay(request.proposed)}</span>
        <span className="text-muted">from {formatPayDay(request.proposed.effectiveFrom)}</span>
      </p>
      <p className="mt-1 text-muted">
        Reason: <span className="text-ink">{request.note}</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        Asked by {request.requestedByName}, {formatDateTime(request.createdAt, zone)}
      </p>
      {request.decidedByName && (
        <p className="mt-1 text-xs text-muted">
          {status.label} by {request.decidedByName}, {formatDateTime(request.decidedAt, zone)}
          {request.decisionNote && <> · “{request.decisionNote}”</>}
        </p>
      )}

      {request.status === 'pending' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {user.role === 'OWNER' && (
            <>
              <Button size="sm" onClick={() => setAnswering('approve')}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAnswering('reject')}>
                Don’t approve
              </Button>
            </>
          )}
          {user.role === 'FRONT_DESK' && isMine && (
            <Button size="sm" variant="secondary" onClick={withdraw} loading={answer.isPending}>
              Withdraw
            </Button>
          )}
        </div>
      )}

      {answering && <AnswerModal request={request} action={answering} onClose={() => setAnswering(null)} />}
    </div>
  );
}
