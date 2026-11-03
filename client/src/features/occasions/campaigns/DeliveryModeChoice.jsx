import { Badge } from '../../../components/ui';

// How offers reach customers: staff send every message, or the app emails customers who allow email.
// Used by the quick setup (step 3) and the campaign page.
export default function DeliveryModeChoice({ value, onChange, disabled = false, emailReady = true, dailyLimit, sendFrom, sendUntil }) {
  const option = (mode, title, text, extra = null) => {
    const picked = value === mode;
    const off = disabled || (mode === 'AUTO_EMAIL' && !emailReady);
    return (
      <label className={`flex items-start gap-2 rounded-lg border p-3 ${picked ? 'border-gold bg-gold/10' : 'border-border'} ${off && !picked ? 'opacity-60' : ''}`}>
        <input type="radio" className="mt-1 accent-gold" checked={picked} disabled={off} onChange={() => onChange(mode)} />
        <span>
          <span className="font-medium">{title}</span> {extra}
          <span className="block text-muted">{text}</span>
        </span>
      </label>
    );
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      {option('STAFF_ASSISTED', 'Staff sends offers', 'The front desk sees who to contact and sends the ready-made message (WhatsApp or SMS from their phone; email through the app).')}
      {option(
        'AUTO_EMAIL',
        'Send automatically by email',
        emailReady
          ? `The app emails customers who allow email, between ${sendFrom ?? '10:00'} and ${sendUntil ?? '19:00'}, at most ${dailyLimit ?? 30} a day for your salon (the rest go the next day). Customers who allow only WhatsApp or SMS stay on the staff list.`
          : 'Email isn’t set up on the server yet, so this can’t be chosen.',
        !emailReady && <Badge>Needs email</Badge>
      )}
      <label className="flex items-start gap-2 rounded-lg border border-border p-3 opacity-60">
        <input type="radio" className="mt-1" disabled />
        <span>
          <span className="font-medium">Send automatically by WhatsApp or SMS</span> <Badge>Coming later</Badge>
        </span>
      </label>
    </div>
  );
}
