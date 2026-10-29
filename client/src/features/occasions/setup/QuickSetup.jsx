import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Check } from 'lucide-react';
import { useServices } from '../../../api/catalog';
import { useCampaignAction, useCampaignPreview, useCampaigns, useOccasionSettings, useSaveOccasionSettings, useStarterCampaigns, useUpdateCampaign } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { OCCASION_LABEL, fromRulesForm, rulesFormErrors, toRulesForm } from '../../../lib/occasions';
import { Badge, Button, EmptyState, PageHeader, Spinner, Tabs } from '../../../components/ui';
import CampaignForm from '../campaigns/CampaignForm';

const STEPS = ['Enable', 'Configure offers', 'Communication & publish'];
const TYPES = ['BIRTHDAY', 'ANNIVERSARY'];
const STATUS_PICK = { PUBLISHED: 0, DRAFT: 1, DISABLED: 2 };

// The salon-wide campaign of each occasion that the setup works on (live first, then a draft)
function salonCampaigns(campaigns) {
  return Object.fromEntries(
    TYPES.map((type) => [
      type,
      campaigns
        .filter((c) => c.type === type && c.scope === 'BUSINESS_DEFAULT' && c.status in STATUS_PICK)
        .sort((a, b) => STATUS_PICK[a.status] - STATUS_PICK[b.status])[0] ?? null,
    ])
  );
}

const needsPublish = (c) => c && ((c.status === 'DRAFT' && c.draftRules) || (c.status === 'PUBLISHED' && c.hasDraft));

// Quick setup in 3 steps (business owner): switch on, set up the Birthday and Anniversary offers, publish.
export default function QuickSetup() {
  const navigate = useNavigate();
  const settingsQuery = useOccasionSettings();
  const [step, setStep] = useState(null);

  if (settingsQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (settingsQuery.isError) return <EmptyState title="Couldn’t load the setup" message={settingsQuery.error.message} />;
  const settings = settingsQuery.data;
  if (!settings.can['occasions.manageSalonCampaigns']) {
    return <EmptyState title="Only the business owner can run the quick setup" action={<Link to="/app/settings/occasions" className="text-sm underline">Occasion offers</Link>} />;
  }
  const current = step ?? (settings.enabled ? 2 : 1);

  return (
    <>
      <Link to="/app/settings/occasions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Occasion offers
      </Link>
      <PageHeader title="Set up Birthday & Anniversary Offers" subtitle="Three short steps. Nothing is sent to customers." />

      <ol className="mb-6 grid gap-2 sm:grid-cols-3">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current || (n === 1 && settings.enabled);
          return (
            <li key={label}>
              <button
                type="button"
                disabled={n > 1 && !settings.enabled}
                onClick={() => setStep(n)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${current === n ? 'border-gold bg-gold/10 font-medium' : 'border-border text-muted hover:bg-surface'}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-good text-white' : 'bg-surface text-ink'}`}>{done ? <Check size={14} /> : n}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="rounded-xl border border-border p-4 md:p-6">
        {current === 1 && <EnableStep settings={settings} onNext={() => setStep(2)} />}
        {current === 2 && <OffersStep onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {current === 3 && <PublishStep onBack={() => setStep(2)} onDone={() => navigate('/app/settings/occasions')} />}
      </div>
    </>
  );
}

function EnableStep({ settings, onNext }) {
  const save = useSaveOccasionSettings();
  const { counts } = settings;
  function switchOn() {
    save.mutate({ key: newRequestKey(), version: settings.version, enabled: true }, { onSuccess: onNext, onError: (err) => toast.error(err.message) });
  }
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-brown">1. Enable</h2>
      <p className="text-sm text-muted">Switching on doesn’t publish an offer or send any message. Here is the customer data you have today:</p>
      <ul className="grid gap-3 text-sm sm:grid-cols-3">
        <li className="rounded-lg border border-border p-3">Birthday month known: <strong>{counts.birthdayKnown}</strong> of {counts.customers}</li>
        <li className="rounded-lg border border-border p-3">Anniversary month known: <strong>{counts.anniversaryKnown}</strong> of {counts.customers}</li>
        <li className="rounded-lg border border-border p-3">Can be messaged: <strong>{counts.canMessage}</strong> of {counts.customers}</li>
      </ul>
      <div className="flex justify-end">
        {settings.enabled ? (
          <Button onClick={onNext}>Next</Button>
        ) : (
          <Button onClick={switchOn} loading={save.isPending}>
            Enable Birthday & Anniversary Offers
          </Button>
        )}
      </div>
    </div>
  );
}

function OffersStep({ onBack, onNext }) {
  const campaignsQuery = useCampaigns();
  const servicesQuery = useServices();
  const starters = useStarterCampaigns();
  const asked = useRef(false);
  const [tab, setTab] = useState('BIRTHDAY');
  const [dirty, setDirty] = useState({});
  const services = useMemo(() => (servicesQuery.data ?? []).filter((s) => s.status === 'active'), [servicesQuery.data]);

  // The starting suggestions are saved as drafts the first time (only for occasions that have no campaign yet)
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    starters.mutate({ key: newRequestKey() });
  }, [starters]);

  if (starters.isError) return <EmptyState title="Couldn’t create the starting offers" message={starters.error.message} action={<Button variant="secondary" onClick={onBack}>Back</Button>} />;
  if (campaignsQuery.isPending || servicesQuery.isPending || starters.isPending) return <Spinner />;
  const picked = salonCampaigns(campaignsQuery.data?.campaigns ?? []);
  const unsaved = Object.values(dirty).some(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-brown">2. Configure offers</h2>
      <p className="text-sm text-muted">We’ve filled in a starting suggestion for each. Change anything you like and save.</p>
      <Tabs tabs={TYPES.map((type) => ({ value: type, label: `${OCCASION_LABEL[type]} Month${dirty[type] ? ' •' : ''}` }))} value={tab} onChange={setTab} />
      {TYPES.map((type) => (
        <div key={type} className={tab === type ? '' : 'hidden'}>
          {picked[type] ? (
            <CampaignEditor key={`${picked[type]._id}-${picked[type].version}`} campaign={picked[type]} services={services} onDirty={(value) => setDirty((d) => (d[type] === value ? d : { ...d, [type]: value }))} />
          ) : (
            <EmptyState title={`No ${OCCASION_LABEL[type]} campaign`} message="It may have been archived. Add one from the Occasion offers page." />
          )}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <span className="flex items-center gap-3">
          {unsaved && <span className="text-xs text-orange">Save your changes first</span>}
          <Button onClick={onNext} disabled={unsaved}>
            Next
          </Button>
        </span>
      </div>
    </div>
  );
}

// One occasion's form inside the setup, with its own Save button
function CampaignEditor({ campaign, services, onDirty }) {
  const update = useUpdateCampaign();
  const initial = useMemo(() => ({ name: campaign.name, ...toRulesForm(campaign.draftRules ?? campaign.rules, services.map((s) => s._id)) }), [campaign, services]);
  const [form, setForm] = useState(initial);
  const errors = rulesFormErrors(form, services.map((s) => s._id));
  if (form.name.trim().length < 2) errors.name = 'Give the campaign a name';
  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => onDirty(isDirty), [isDirty, onDirty]);

  function save() {
    update.mutate(
      { key: newRequestKey(), id: campaign._id, version: campaign.version, name: form.name.trim(), rules: fromRulesForm(form) },
      { onSuccess: () => toast.success('Saved'), onError: (err) => toast.error(err.message) }
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {campaign.status === 'PUBLISHED' && <p className="rounded-lg bg-yellow-soft p-3 text-sm">This offer is already live. Saved changes become its next version when you publish.</p>}
      <CampaignForm form={form} onChange={setForm} errors={errors} services={services} />
      <div className="flex justify-end">
        <Button variant="secondary" onClick={save} disabled={!isDirty || Object.keys(errors).length > 0} loading={update.isPending}>
          Save {OCCASION_LABEL[campaign.type].toLowerCase()} offer
        </Button>
      </div>
    </div>
  );
}

function PublishStep({ onBack, onDone }) {
  const campaignsQuery = useCampaigns();
  const publish = useCampaignAction();
  const [publishing, setPublishing] = useState(false);
  if (campaignsQuery.isPending) return <Spinner />;
  const picked = TYPES.map((type) => salonCampaigns(campaignsQuery.data.campaigns)[type]).filter(Boolean);
  const toPublish = picked.filter(needsPublish);

  async function publishAll() {
    setPublishing(true);
    try {
      for (const c of toPublish) await publish.mutateAsync({ key: newRequestKey(), id: c._id, action: 'publish' });
      toast.success('Offers published');
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-brown">3. Communication & publish</h2>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-start gap-2 rounded-lg border border-gold bg-gold/10 p-3">
          <input type="radio" className="mt-1 accent-gold" checked readOnly />
          <span>
            <span className="font-medium">Staff sends offers</span>
            <span className="block text-muted">The front desk sees who to contact and sends the ready-made message from their phone (WhatsApp, SMS or email).</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-lg border border-border p-3 opacity-60">
          <input type="radio" className="mt-1" disabled />
          <span>
            <span className="font-medium">Send automatically</span> <Badge>Coming later</Badge>
          </span>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-muted">
            <tr>
              {['Campaign', 'Offer', 'Active', 'Eligible this month', 'Can be messaged', 'Mode'].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {picked.map((c) => (
              <SummaryRow key={c._id} campaign={c} />
            ))}
          </tbody>
        </table>
      </div>
      {toPublish.length === 0 && <p className="text-sm text-muted">Everything is already live. You can change offers any time from the Occasion offers page.</p>}

      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        {toPublish.length > 0 ? (
          <Button onClick={publishAll} loading={publishing}>
            Publish {toPublish.length === 1 ? toPublish[0].name : `${toPublish.length} offers`}
          </Button>
        ) : (
          <Button onClick={onDone}>Done</Button>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ campaign }) {
  const preview = useCampaignPreview(campaign._id);
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-3 font-medium">
        {campaign.name}
        {campaign.status === 'PUBLISHED' && (
          <span className="ml-2">
            <Badge tone="gold">{campaign.hasDraft ? 'Live, changes to publish' : 'Live'}</Badge>
          </span>
        )}
      </td>
      <td className="px-4 py-3">{campaign.draftSummary ?? campaign.offerSummary}</td>
      <td className="px-4 py-3">Whole {OCCASION_LABEL[campaign.type].toLowerCase()} month</td>
      <td className="px-4 py-3">{preview.data?.eligible ?? '…'}</td>
      <td className="px-4 py-3">{preview.data?.canMessage ?? '…'}</td>
      <td className="px-4 py-3">Staff sends offers</td>
    </tr>
  );
}
