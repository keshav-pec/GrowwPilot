import { useState } from 'react';
import toast from 'react-hot-toast';
import { useSaveCampaignMessages } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
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
        Staff send these from their own phone. Keep {NEEDED.join(', ')} and the opt-out line. <code>{'{salon_phone}'}</code> is your salon’s contact number.
      </p>
      <Tabs tabs={CHANNELS.map((c) => ({ ...c, label: problems[c.value] ? `${c.label} •` : c.label }))} value={tab} onChange={setTab} />
      <fieldset disabled={!editable} className="flex flex-col gap-3">
        {tab === 'EMAIL' && <Input label="Subject" value={messages.EMAIL.subject} onChange={set('subject')} />}
        <Textarea rows={tab === 'EMAIL' ? 8 : 4} value={messages[tab].body} onChange={set('body')} error={problems[tab]} />
      </fieldset>
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
