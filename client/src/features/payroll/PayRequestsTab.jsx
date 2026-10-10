import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { usePayRequests } from '../../api/payroll';
import { EmptyState, Spinner } from '../../components/ui';
import PayRequestCard from './PayRequestCard';

// Owners: front desk requests to approve. Front desk: their branch's requests and the answers.
export default function PayRequestsTab() {
  const { user } = useAuth();
  const [status, setStatus] = useState('pending');
  const requestsQuery = usePayRequests(status);
  const requests = requestsQuery.data ?? [];

  return (
    <>
      <div className="mb-4 flex gap-2">
        {[
          ['pending', 'Waiting'],
          ['all', 'All'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`rounded-full border px-3 py-1 text-sm ${status === value ? 'border-gold bg-gold/15 font-medium text-ink' : 'border-border text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {requestsQuery.isPending ? (
        <Spinner size={24} />
      ) : requestsQuery.isError ? (
        <p className="text-sm text-danger">{requestsQuery.error.message}</p>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={status === 'pending' ? 'Nothing waiting' : 'No requests yet'}
          message={
            user.role === 'OWNER'
              ? 'When the front desk asks to change someone’s pay, it shows up here for you to approve.'
              : 'To ask for a pay change, open someone in Pay setup and click “Request a change”.'
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {requests.map((request) => (
            <PayRequestCard key={request._id} request={request} showBranch={user.branches.length > 1} />
          ))}
        </div>
      )}
    </>
  );
}
