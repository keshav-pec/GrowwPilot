import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../auth/AuthContext';
import { useServices } from '../../../api/catalog';
import { useCreateCampaign, useUpdateCampaign } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { fromRulesForm, rulesFormErrors, toRulesForm } from '../../../lib/occasions';
import { Button, Modal, Select, Spinner } from '../../../components/ui';
import CampaignForm from './CampaignForm';

// Add a campaign (campaign = null) or edit one. A live campaign's new terms are saved as a draft of its next
// version: offers already given keep their terms until it is published.
// canCreateSalonWide: the business owner; branch owners only add "This branch only" campaigns for their branches.
export default function CampaignFormModal({ campaign, canCreateSalonWide, onClose, onSaved }) {
  const { user } = useAuth();
  const servicesQuery = useServices();
  const services = useMemo(() => (servicesQuery.data ?? []).filter((s) => s.status === 'active'), [servicesQuery.data]);
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const [key] = useState(newRequestKey);
  const [type, setType] = useState(campaign?.type ?? 'BIRTHDAY');
  const [scope, setScope] = useState(campaign?.scope ?? (canCreateSalonWide ? 'BUSINESS_DEFAULT' : 'BRANCH_ONLY'));
  const [branchId, setBranchId] = useState(campaign?.branchId ?? user.branches[0]?._id ?? '');
  const [form, setForm] = useState(null); // filled once services are loaded
  const locked = campaign?.currentVersion > 0; // occasion and branches are fixed after the first publish

  if (servicesQuery.isSuccess && !form) {
    const terms = campaign ? (campaign.draftRules ?? campaign.rules) : null;
    setForm({ name: campaign?.name ?? '', ...toRulesForm(terms, services.map((s) => s._id)) });
  }

  const errors = form ? rulesFormErrors(form, services.map((s) => s._id)) : {};
  if (form && form.name.trim().length < 2) errors.name = 'Give the campaign a name';
  const saving = createCampaign.isPending || updateCampaign.isPending;

  function save() {
    const body = { name: form.name.trim(), rules: fromRulesForm(form) };
    if (!locked) Object.assign(body, { type, scope, branchId: scope === 'BRANCH_ONLY' ? branchId : null });
    const done = {
      onSuccess: (saved) => {
        toast.success(campaign ? (locked ? 'Changes saved. Publish them to use them for new offers.' : 'Campaign saved') : 'Draft campaign added');
        onSaved?.(saved);
        onClose();
      },
      onError: (err) => toast.error(err.message),
    };
    if (campaign) updateCampaign.mutate({ key, id: campaign._id, version: campaign.version, ...body }, done);
    else createCampaign.mutate({ key, ...body }, done);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={campaign ? `Edit ${campaign.name}` : 'Add campaign'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!form || Object.keys(errors).length > 0} loading={saving}>
            {locked ? 'Save changes as draft' : 'Save draft'}
          </Button>
        </>
      }
    >
      {!form ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Occasion" disabled={locked} value={type} onChange={(e) => setType(e.target.value)} options={[{ value: 'BIRTHDAY', label: 'Birthday month' }, { value: 'ANNIVERSARY', label: 'Anniversary month' }]} />
            <Select
              label="Applies to"
              disabled={locked || !canCreateSalonWide}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              options={[{ value: 'BUSINESS_DEFAULT', label: 'All branches' }, { value: 'BRANCH_ONLY', label: 'This branch only' }]}
            />
            {scope === 'BRANCH_ONLY' && <Select label="Branch" disabled={locked} value={branchId} onChange={(e) => setBranchId(e.target.value)} options={user.branches.map((b) => ({ value: b._id, label: b.name }))} />}
          </div>
          {scope === 'BRANCH_ONLY' && <p className="text-xs text-muted">Replaces the all-branches campaign for customers whose home branch is this branch.</p>}
          {locked && <p className="rounded-lg bg-yellow-soft p-3 text-sm">This campaign is published. Your changes become version {campaign.currentVersion + 1} when you publish them; offers already given keep their terms.</p>}
          <CampaignForm form={form} onChange={setForm} errors={errors} services={services} />
        </div>
      )}
    </Modal>
  );
}
