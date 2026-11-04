import { useState } from 'react';
import { DateTime } from 'luxon';
import { useAuth } from '../../../auth/AuthContext';
import toast from 'react-hot-toast';
import { useSaveCampaignMessages } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/requestKey';
import { Button, Card, Input, Tabs, Textarea } from '../../../components/ui';

const NEEDED = ['{first_name}', '{salon_name}', '{offer_summary}', '{expiry_date}'];
const CHANNELS = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SMS', label: 'SMS' },
  { value: 'EMAIL', label: 'Email' },
];

// The ready-made messages staff send. Owners can change the wording; it must keep the customer's name, the
// salon, the offer, the expiry date and the opt-out line. {salon_phone} is the salon's contact number.
export default function CampaignMessagesCard({ campaign }) {
  const save = useSaveCampaignMessages();
  const [key, setKey] = useState(newRequestKey);
  const [tab, setTab] = useState('WHATSAPP');
  const [messages, setMessages] = useState(campaign.messages);
  const editable = campaign.canManage && campaign.status !== 'ARCHIVED';
  const changed = JSON.stringify(messages) !== JSON.stringify(campaign.messages);

  const problems = Object.fromEntries(
    CHANNELS.map(({ value, label }) => {
      const body = messages[value].body;
      const missing = NEEDED.filter((p) => !body.includes(p));
      if (missing.length) return [value, `${label}: keep ${missing.join(', ')}`];
      if (!/opt[\s-]?out/i.test(body)) return [value, `${label}: keep the opt-out line`];
      return [value, null];
    })
  );
  const firstProblem = Object.values(problems).find(Boolean);
  const set = (field) => (e) => setMessages((m) => ({ ...m, [tab]: { ...m[tab], [field]: e.target.value } }));

  function submit() {
    save.mutate(
      { key, id: campaign._id, version: campaign.version, ...messages },
      {
        onSuccess: () => {
          setKey(newRequestKey());
          toast.success('Message wording saved');
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Card title="Message wording" className="mb-4">
      <p className="mb-3 text-sm text-muted">
        Staff send WhatsApp and SMS from their own phone; when email is set up, the app sends the email. Keep {NEEDED.join(', ')} and the opt-out line. <code>{'{salon_phone}'}</code> is your salon’s contact number.
      </p>
      <Tabs tabs={CHANNELS.map((c) => ({ ...c, label: problems[c.value] ? `${c.label} •` : c.label }))} value={tab} onChange={setTab} />
      <fieldset disabled={!editable} className="flex flex-col gap-3">
        {tab === 'EMAIL' && <Input label="Subject" value={messages.EMAIL.subject} onChange={set('subject')} />}
        <Textarea rows={tab === 'EMAIL' ? 8 : 4} value={messages[tab].body} onChange={set('body')} error={problems[tab]} />
      </fieldset>
      {tab === 'EMAIL' && <EmailPreview campaign={campaign} email={messages.EMAIL} />}
      {editable && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {firstProblem && <span className="text-xs text-danger">{firstProblem}</span>}
          {changed && (
            <Button variant="secondary" onClick={() => setMessages(campaign.messages)}>
              Undo
            </Button>
          )}
          <Button disabled={!changed || Boolean(firstProblem)} loading={save.isPending} onClick={submit}>
            Save wording
          </Button>
        </div>
      )}
    </Card>
  );
}

// How the email will look, with example values. The footer and the unsubscribe link are always added by the app.
function EmailPreview({ campaign, email }) {
  const { user } = useAuth();
  const salon = user.org?.name ?? 'Your salon';
  const values = {
    '{first_name}': 'Priya',
    '{salon_name}': salon,
    '{offer_summary}': campaign.offerSummary ?? 'your offer',
    '{expiry_date}': DateTime.now().endOf('month').toFormat('d LLL yyyy'),
    '{salon_phone}': 'your salon’s number',
  };
  const fill = (text) => Object.entries(values).reduce((out, [key, value]) => out.replaceAll(key, value), text ?? '');
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium text-muted">Preview (example customer: Priya)</p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface p-3">
        <div className="mx-auto max-w-md overflow-hidden rounded-lg border border-border bg-bg">
          <p className="border-b border-border px-4 py-2 text-xs text-muted">
            <span className="font-medium text-ink">{salon}</span> · {fill(email.subject)}
          </p>
          <p className="border-b-[3px] border-gold px-4 py-3 font-bold text-brown">{salon}</p>
          <p className="whitespace-pre-wrap px-4 py-4 text-sm">{fill(email.body)}</p>
          <p className="border-t border-border px-4 py-3 text-xs text-muted">
            {salon}
            <br />
            You’re getting this because you agreed to receive offers from {salon} by email.
            <br />
            <span className="text-brown underline">Unsubscribe</span>
          </p>
        </div>
      </div>
    </div>
  );
}
