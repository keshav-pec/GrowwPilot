import { useState } from 'react';
import toast from 'react-hot-toast';
import { Cake, FileSpreadsheet, Heart, Info, MessageCircle } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useOccasionSettings, useSaveOccasionSettings } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { formatDateTime } from '../../../lib/time';
import { Button, Card, EmptyState, PageHeader, Spinner, Textarea } from '../../../components/ui';
import ImportDatesModal from './ImportDatesModal';
import CampaignList from '../campaigns/CampaignList';

// Settings → Occasion offers (owners). The business owner switches the feature on and sets the consent wording;
// branch owners can only look. Switching on doesn't publish or send anything.
export default function OccasionSettingsPage() {
  const settingsQuery = useOccasionSettings();
  if (settingsQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (settingsQuery.isError) return <EmptyState title="Couldn’t load occasion offer settings" message={settingsQuery.error.message} />;
  return <SettingsView key={settingsQuery.data.version} saved={settingsQuery.data} />;
}

function SettingsView({ saved }) {
  const { activeBranch } = useAuth();
  const save = useSaveOccasionSettings();
  const [key, setKey] = useState(newRequestKey);
  const [consentText, setConsentText] = useState(saved.consentText);
  const [importing, setImporting] = useState(false);
  const canEdit = saved.can['occasions.manageSettings'];
  const { counts } = saved;

  function submit(changes, message) {
    save.mutate(
      { key, version: saved.version, ...changes },
      {
        onSuccess: () => {
          setKey(newRequestKey());
          toast.success(message);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const wordingError = consentText.trim().length < 20 ? 'The wording is too short' : !/opt[\s-]?out/i.test(consentText) ? 'The wording must say the customer can opt out' : null;
  const wordingChanged = consentText.trim() !== saved.consentText;

  return (
    <>
      <PageHeader title="Birthday & Anniversary Offers" subtitle="Settings" />
      {!canEdit && <p className="mb-4 rounded-lg bg-surface p-3 text-sm text-muted">Only the business owner can change these settings.</p>}

      <div className="flex flex-col gap-4">
        <Card title="Feature switch">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-gold"
              checked={saved.enabled}
              disabled={!canEdit || save.isPending}
              onChange={(e) => submit({ enabled: e.target.checked }, e.target.checked ? 'Birthday & Anniversary Offers switched on' : 'Birthday & Anniversary Offers switched off')}
            />
            <span>
              <span className="font-medium">Enable Birthday & Anniversary Offers</span>
              <span className="block text-sm text-muted">Switching on doesn’t publish an offer or send any message. You set up the offers next.</span>
              {saved.changedAt && (
                <span className="mt-1 block text-xs text-muted">
                  {saved.enabled ? 'Switched on' : 'Switched off'} {formatDateTime(saved.changedAt, activeBranch.timezone)}
                  {saved.changedByName && ` by ${saved.changedByName}`}
                </span>
              )}
            </span>
          </label>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Count icon={Cake} label="Birthday month known" value={counts.birthdayKnown} of={counts.customers} />
            <Count icon={Heart} label="Anniversary month known" value={counts.anniversaryKnown} of={counts.customers} />
            <Count icon={MessageCircle} label="At least one messaging permission" value={counts.canMessage} of={counts.customers} />
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted">
            <Info size={14} className="mt-0.5 shrink-0" />
            Add birthdays and anniversaries on each customer’s profile, or import them below. Customers without permission can still use their offer in the salon.
          </p>
        </Card>

        <CampaignList />

        <Card title="Consent wording">
          <p className="mb-3 text-sm text-muted">
            What staff read or show to a customer before recording permission. <code>{'{salon_name}'}</code> and <code>{'{channel}'}</code> are filled in. Changing it starts a new version (now{' '}
            {saved.noticeVersion}); permissions already given keep the version they were given on.
          </p>
          <Textarea rows={3} value={consentText} disabled={!canEdit} onChange={(e) => setConsentText(e.target.value)} error={canEdit && wordingChanged ? wordingError : null} />
          {canEdit && (
            <div className="mt-3 flex justify-end gap-2">
              {wordingChanged && (
                <Button variant="secondary" onClick={() => setConsentText(saved.consentText)}>
                  Undo
                </Button>
              )}
              <Button disabled={!wordingChanged || Boolean(wordingError)} loading={save.isPending} onClick={() => submit({ consentText: consentText.trim() }, 'Consent wording saved')}>
                Save wording
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Please have a lawyer check this wording before you start sending offers.</p>
        </Card>

        {saved.can['occasions.importDates'] && (
          <Card title="Import birthdays and anniversaries">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">Fill in many customers at once from a spreadsheet{saved.can['occasions.manageSettings'] ? '' : ' (your branches’ customers)'}.</p>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <FileSpreadsheet size={16} /> Import dates
              </Button>
            </div>
          </Card>
        )}
      </div>

      {importing && <ImportDatesModal onClose={() => setImporting(false)} />}
    </>
  );
}

function Count({ icon: Icon, label, value, of }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-1 text-xs text-muted">
        <Icon size={14} /> {label}
      </p>
      <p className="text-2xl font-bold text-brown">
        {value} <span className="text-sm font-normal text-muted">of {of}</span>
      </p>
    </div>
  );
}
