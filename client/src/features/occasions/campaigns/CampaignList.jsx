import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Plus, Wand2 } from 'lucide-react';
import { useCampaigns } from '../../../api/occasions';
import { CAMPAIGN_STATUS, DELIVERY_LABEL, OCCASION_LABEL } from '../../../lib/occasions';
import { Badge, Button, Card, EmptyState, Spinner, Table } from '../../../components/ui';
import CampaignFormModal from './CampaignFormModal';

// Settings → Occasion offers: the campaigns, delivery readiness and this month's audience
export default function CampaignList() {
  const navigate = useNavigate();
  const campaignsQuery = useCampaigns();
  const [adding, setAdding] = useState(false);

  if (campaignsQuery.isPending) return <Spinner />;
  if (campaignsQuery.isError) return <EmptyState title="Couldn’t load campaigns" message={campaignsQuery.error.message} />;
  const { campaigns, audience, can } = campaignsQuery.data;
  const anyLive = campaigns.some((c) => c.status === 'PUBLISHED');

  const columns = [
    {
      key: 'name',
      header: 'Campaign',
      render: (c) => (
        <span>
          <span className="font-medium">{c.name}</span>
          <span className="block text-xs text-muted">{c.offerSummary}</span>
        </span>
      ),
    },
    { key: 'type', header: 'Occasion', render: (c) => `${OCCASION_LABEL[c.type]} month` },
    { key: 'scope', header: 'Applies to', render: (c) => c.scopeLabel },
    { key: 'mode', header: 'Mode', render: (c) => DELIVERY_LABEL[c.deliveryMode] },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge>
          {c.hasDraft && <span className="text-xs text-orange">Changes not published</span>}
        </span>
      ),
    },
    {
      key: 'edit',
      header: '',
      render: (c) => (
        <Link to={`/app/settings/occasions/campaigns/${c._id}`} className="text-sm font-medium text-brown underline" onClick={(e) => e.stopPropagation()}>
          {c.canManage ? 'Edit' : 'View'}
        </Link>
      ),
    },
  ];

  return (
    <Card
      title="Campaigns"
      actions={
        <div className="flex flex-wrap gap-2">
          {can.createSalonCampaign && (
            <Button size="sm" variant={anyLive ? 'secondary' : 'primary'} onClick={() => navigate('/app/settings/occasions/setup')}>
              <Wand2 size={14} /> Quick setup
            </Button>
          )}
          {can.createBranchCampaign && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add campaign
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Delivery</p>
          <p className="mt-1 flex items-center gap-1 text-sm font-medium text-brown">
            <CheckCircle2 size={16} className="text-good" /> Staff reminders ready
          </p>
        </div>
        <Tile label="Offers due this month" value={audience.eligible} />
        <Tile label="Can be messaged" value={audience.canMessage} />
        <Tile label="Still to do" value={audience.toDo ?? '—'} hint={audience.toDo == null ? 'Shown once the occasion list is ready' : null} />
      </div>
      <Table
        columns={columns}
        rows={campaigns}
        onRowClick={(c) => navigate(`/app/settings/occasions/campaigns/${c._id}`)}
        empty={<EmptyState title="No campaigns yet" message={can.createSalonCampaign ? 'Use Quick setup to create the Birthday and Anniversary offers in three steps.' : 'The business owner hasn’t set up any offers yet.'} />}
      />
      {adding && <CampaignFormModal canCreateSalonWide={can.createSalonCampaign} onClose={() => setAdding(false)} onSaved={(saved) => navigate(`/app/settings/occasions/campaigns/${saved._id}`)} />}
    </Card>
  );
}

function Tile({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold text-brown">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
