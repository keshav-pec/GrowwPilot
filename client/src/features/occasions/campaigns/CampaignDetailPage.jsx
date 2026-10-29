import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useServices } from '../../../api/catalog';
import { useCampaign, useCampaignAction, useCampaignPreview, useCampaignVersions, useOccasionSettings, useRevokeOffers } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { CAMPAIGN_STATUS, DELIVERY_LABEL, OCCASION_LABEL, formatOccasion } from '../../../lib/occasions';
import { formatDateTime } from '../../../lib/time';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Spinner, Table, Textarea } from '../../../components/ui';
import CampaignFormModal from './CampaignFormModal';

// What each button does, in the confirm popup
const ACTIONS = {
  publish: { label: 'Publish', confirm: (c) => (c.currentVersion > 0 ? `Publish these changes as version ${c.currentVersion + 1}? New offers use them; offers already given keep their terms.` : 'Publish this campaign? Customers in their occasion month will get the offer.') },
  'discard-draft': { label: 'Discard changes', confirm: () => 'Throw away the unpublished changes? The live terms stay as they are.', danger: true },
  disable: { label: 'Turn off', confirm: () => 'Turn this campaign off? No new offers are given; offers already given can still be used until their month ends.', danger: true },
  enable: { label: 'Turn back on', confirm: () => 'Turn this campaign back on?' },
  archive: { label: 'Archive', confirm: () => 'Archive this campaign? It is hidden from the list; its versions are kept.', danger: true },
};

// One campaign: its terms, unpublished changes, version history, this month's audience, and its buttons
export default function CampaignDetailPage() {
  const { id } = useParams();
  const { activeBranch } = useAuth();
  const campaignQuery = useCampaign(id);
  const versionsQuery = useCampaignVersions(id);
  const servicesQuery = useServices();
  const runAction = useCampaignAction();
  const [showPreview, setShowPreview] = useState(false);
  const previewQuery = useCampaignPreview(id, showPreview);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(null); // an ACTIONS key
  const [key, setKey] = useState(newRequestKey);
  const [withdrawing, setWithdrawing] = useState(false);
  const settingsQuery = useOccasionSettings();
  const canWithdraw = Boolean(settingsQuery.data?.can['occasions.revokeOffers']);

  if (campaignQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (campaignQuery.isError) return <EmptyState title="Campaign not found" message={campaignQuery.error.message} action={<Link to="/app/settings/occasions" className="text-sm underline">Occasion offers</Link>} />;
  const c = campaignQuery.data;
  const zone = activeBranch.timezone;
  const serviceName = new Map((servicesQuery.data ?? []).map((s) => [s._id, s.name]));
  const canPublish = c.canManage && ((c.status === 'DRAFT' && c.draftRules) || (c.status === 'PUBLISHED' && c.hasDraft));

  function confirmAction() {
    runAction.mutate(
      { key, id: c._id, action: confirming },
      {
        onSuccess: () => {
          toast.success(`${ACTIONS[confirming].label}: done`);
          setConfirming(null);
          setKey(newRequestKey());
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const versionColumns = [
    { key: 'version', header: 'Version', render: (v) => `v${v.version}` },
    { key: 'offer', header: 'Offer', render: (v) => v.offerSummary },
    { key: 'by', header: 'Published by', render: (v) => v.publishedByName },
    { key: 'when', header: 'When', render: (v) => formatDateTime(v.publishedAt, zone) },
  ];
  const audienceColumns = [
    { key: 'name', header: 'Customer', render: (p) => `${p.name} · ${p.phone}` },
    { key: 'date', header: 'Occasion', render: (p) => formatOccasion(p.date) },
    { key: 'branch', header: 'Home branch', render: (p) => p.homeBranchName ?? '—' },
    { key: 'message', header: 'Messaging', render: (p) => (p.canMessage ? <Badge tone="gold">Can be messaged</Badge> : <Badge>In-salon only</Badge>) },
  ];

  return (
    <>
      <Link to="/app/settings/occasions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Occasion offers
      </Link>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge>
            {OCCASION_LABEL[c.type]} month · {c.scopeLabel} · {DELIVERY_LABEL[c.deliveryMode]}
            {c.currentVersion > 0 && ` · version ${c.currentVersion}`}
          </span>
        }
        actions={
          c.canManage &&
          c.status !== 'ARCHIVED' && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={16} /> Edit
              </Button>
              {canPublish && <Button onClick={() => setConfirming('publish')}>{c.currentVersion > 0 ? 'Publish changes' : 'Publish'}</Button>}
              {c.hasDraft && (
                <Button variant="ghost" onClick={() => setConfirming('discard-draft')}>
                  Discard changes
                </Button>
              )}
              {c.status === 'PUBLISHED' && (
                <Button variant="secondary" onClick={() => setConfirming('disable')}>
                  Turn off
                </Button>
              )}
              {c.status === 'DISABLED' && (
                <Button variant="secondary" onClick={() => setConfirming('enable')}>
                  Turn back on
                </Button>
              )}
              {['DISABLED', 'DRAFT'].includes(c.status) && (
                <Button variant="ghost" onClick={() => setConfirming('archive')}>
                  Archive
                </Button>
              )}
            </>
          )
        }
      />
      {!c.canManage && <p className="mb-4 rounded-lg bg-surface p-3 text-sm text-muted">You can look at this campaign. Only the business owner changes campaigns for all branches.</p>}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Rules title={c.currentVersion > 0 ? `Live terms (version ${c.currentVersion})` : 'Draft terms'} summary={c.offerSummary} rules={c.rules} serviceName={serviceName} />
        {c.hasDraft && <Rules title={`Unpublished changes (version ${c.currentVersion + 1})`} summary={c.draftSummary} rules={c.draftRules} serviceName={serviceName} highlight />}
      </div>

      <Card title="This month’s audience" className="mb-4">
        {!showPreview ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">See who would get this offer this month{c.status === 'PUBLISHED' ? '' : ' if it were live'}. Nothing is saved or sent.</p>
            <Button variant="secondary" onClick={() => setShowPreview(true)}>
              Preview audience
            </Button>
          </div>
        ) : previewQuery.isPending ? (
          <Spinner />
        ) : previewQuery.isError ? (
          <p className="text-sm text-danger">{previewQuery.error.message}</p>
        ) : (
          <>
            <p className="mb-3 text-sm">
              <strong>{previewQuery.data.eligible}</strong> customer{previewQuery.data.eligible === 1 ? '' : 's'} this month, <strong>{previewQuery.data.canMessage}</strong> can be messaged.
              {previewQuery.data.eligible > 50 && ' Showing the first 50.'}
            </p>
            <Table columns={audienceColumns} rows={previewQuery.data.customers} empty={<EmptyState title="No one this month" message="No customer at these branches has this occasion in the current month." />} />
          </>
        )}
      </Card>

      {canWithdraw && c.currentVersion > 0 && (
        <Card title="Emergency withdraw" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Takes back every unused offer of this campaign for a year (for example a wrong price). Used offers and their bills stay as they are.</p>
            <Button variant="danger" onClick={() => setWithdrawing(true)}>
              Withdraw unused offers
            </Button>
          </div>
        </Card>
      )}

      <Card title="Version history">
        {versionsQuery.isPending ? (
          <Spinner />
        ) : (
          <Table columns={versionColumns} rows={versionsQuery.data ?? []} empty={<EmptyState title="Not published yet" message="Each publish is kept here and never changes." />} />
        )}
      </Card>

      {withdrawing && <WithdrawModal campaign={c} onClose={() => setWithdrawing(false)} />}
      {editing && <CampaignFormModal campaign={c} canCreateSalonWide={c.scope === 'BUSINESS_DEFAULT'} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={confirmAction}
        title={confirming ? ACTIONS[confirming].label : ''}
        message={confirming ? ACTIONS[confirming].confirm(c) : ''}
        confirmLabel={confirming ? ACTIONS[confirming].label : ''}
        danger={confirming ? ACTIONS[confirming].danger : false}
        loading={runAction.isPending}
      />
    </>
  );
}

function Rules({ title, summary, rules, serviceName, highlight }) {
  const names = (rules?.serviceIds ?? []).map((id) => serviceName.get(id)).filter(Boolean);
  return (
    <Card title={title} className={highlight ? 'border-orange' : ''}>
      <p className="mb-2 text-lg font-semibold text-brown">{summary}</p>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="inline text-muted">Services: </dt>
          <dd className="inline">{names.length ? names.join(', ') : '—'}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Active period: </dt>
          <dd className="inline">the whole occasion month, every year, once per customer per occasion</dd>
        </div>
      </dl>
    </Card>
  );
}

// Emergency withdraw: pick a year, type a reason, confirm
function WithdrawModal({ campaign, onClose }) {
  const revoke = useRevokeOffers();
  const [key] = useState(newRequestKey);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const ready = /^\d{4}$/.test(year) && reason.trim().length >= 3 && sure;

  function confirm() {
    revoke.mutate(
      { key, id: campaign._id, year: Number(year), reason: reason.trim() },
      {
        onSuccess: (r) => {
          toast.success(`Withdrew ${r.revoked} offer${r.revoked === 1 ? '' : 's'}${r.toTell ? `; ${r.toTell} customer${r.toTell === 1 ? '' : 's'} to let know` : ''}`);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Withdraw unused ${campaign.name} offers`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ready} loading={revoke.isPending} onClick={confirm}>
            Withdraw
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">Every unused offer of this campaign for the year is withdrawn straight away. Customers who were already contacted get a task so staff can let them know. This can’t be undone.</p>
        <Input label="Year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong discount was published" />
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-gold" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          I understand unused offers will stop working
        </label>
      </div>
    </Modal>
  );
}
