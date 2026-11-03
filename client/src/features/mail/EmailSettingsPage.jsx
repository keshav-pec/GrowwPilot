import { useState } from 'react';
import { CircleAlert, CircleCheck, Mail } from 'lucide-react';
import { useMailStatus, useSendTestEmail, useTestEmail } from '../../api/mail';
import { newRequestKey } from '../../lib/billing';
import { formatDateTime } from '../../lib/time';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';

const ROUTE_LABELS = { APPS_SCRIPT: 'Google Apps Script', SMTP: 'Gmail SMTP (backup)', LOG: 'not sent: email isn’t set up, so it was printed in the server log' };

// Settings → Email (business owner): is email set up, how much of today's limit is used, and a test email
export default function EmailSettingsPage() {
  const statusQuery = useMailStatus();
  if (statusQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (statusQuery.isError) return <EmptyState icon={Mail} title="Couldn’t load email settings" message={statusQuery.error.message} />;

  const status = statusQuery.data;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Email" subtitle="Emails the app sends for your salon. Replies go to your salon’s contact email." />
      <div className="space-y-4">
        <StatusCard status={status} />
        {status.mode !== 'off' && <TestEmailCard to={status.testTo} />}
      </div>
    </div>
  );
}

function StatusCard({ status }) {
  const { mode, routes, script, salon } = status;
  return (
    <Card title="Email" actions={<StatusBadge mode={mode} />}>
      <div className="space-y-3 text-sm">
        {mode === 'live' ? (
          <>
            <p>
              Sends through <strong>{routes.appsScript ? 'Google Apps Script' : 'Gmail SMTP'}</strong>
              {routes.appsScript && (routes.smtp ? ', with Gmail SMTP as a backup.' : '. No backup is set up.')}
            </p>
            {script && (
              <p className={`flex items-center gap-1.5 ${script.reachable ? 'text-ink' : 'text-danger'}`}>
                {script.reachable ? <CircleCheck size={16} className="text-good" /> : <CircleAlert size={16} />}
                {script.reachable ? 'The mail script is answering.' : `The mail script isn’t answering: ${script.message}.`}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted">
            {mode === 'log'
              ? 'Test mode: emails are printed in the server’s log instead of being sent. '
              : 'The app can’t send emails yet. Until it can, staff send offer emails from their own phone or computer. '}
            Whoever runs the server can set it up with “Setting up email” in the README.
          </p>
        )}

        {status.pausedUntil && (
          <p className="rounded-lg border border-orange/40 bg-orange/10 px-3 py-2 text-orange">
            Gmail’s daily sending limit was reached. Emails start going out again at {formatDateTime(status.pausedUntil)}.
          </p>
        )}

        {mode === 'live' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Sent in the last 24 hours (whole app)" value={`${status.sentLast24h} of ${status.dailyLimit}`} hint="The daily limit is shared by every salon on GrowwPilot." />
            <Stat label="Sent for your salon (24 hours)" value={salon.sentLast24h} />
            <Stat label="Waiting to go out" value={salon.waiting} />
            <Stat label="Couldn’t be sent (last 7 days)" value={salon.failedLast7Days} danger={salon.failedLast7Days > 0} />
          </div>
        )}
      </div>
    </Card>
  );
}

function StatusBadge({ mode }) {
  if (mode === 'live') return <Badge tone="gold">Set up</Badge>;
  if (mode === 'log') return <Badge tone="yellow">Not set up (test mode)</Badge>;
  return <Badge tone="danger">Not set up</Badge>;
}

function Stat({ label, value, hint, danger = false }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold ${danger ? 'text-danger' : 'text-ink'}`}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function TestEmailCard({ to }) {
  const send = useSendTestEmail();
  const [testId, setTestId] = useState(null);
  const test = useTestEmail(testId);
  const state = test.data?.status ?? (testId ? 'PENDING' : null);
  // A retry can be an hour away: stop the spinner once the card shows why it's waiting
  const waiting = send.isPending || ((state === 'PENDING' || state === 'SENDING') && !test.data?.error);

  function sendTest() {
    setTestId(null);
    send.mutate({ key: newRequestKey() }, { onSuccess: (queued) => setTestId(queued.id) });
  }

  return (
    <Card title="Test email">
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Sends a short email to <strong className="text-ink">{to}</strong> (your login email), so you can check it arrives.
        </p>
        <Button onClick={sendTest} loading={waiting}>
          <Mail size={16} /> Send test email
        </Button>

        {send.isError && <p className="text-danger">{send.error.message}</p>}
        {waiting && testId && <p className="text-muted">Sending…</p>}
        {state === 'SENT' && (
          <p className="flex items-center gap-1.5">
            <CircleCheck size={16} className="text-good" />
            {test.data.via === 'LOG' ? `Done: ${ROUTE_LABELS.LOG}.` : `Sent through ${ROUTE_LABELS[test.data.via]}. Check your inbox (and the spam folder).`}
          </p>
        )}
        {(state === 'FAILED' || state === 'SKIPPED') && (
          <p className="flex items-center gap-1.5 text-danger">
            <CircleAlert size={16} /> Not sent. {test.data.error}
          </p>
        )}
        {state === 'PENDING' && test.data?.error && <p className="text-orange">Trying again: {test.data.error}</p>}
      </div>
    </Card>
  );
}
