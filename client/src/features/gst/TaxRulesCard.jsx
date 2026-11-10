import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { refusalText, useApproveRule, useDeleteRule, useLinkUnlinked, useSaveRule } from '../../api/gst';
import { GST_RATE_OPTIONS, ITC_LABEL, ITC_OPTIONS, percentLabel } from '../../lib/billing';
import { formatDate } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, ModalFooter, Select } from '../../components/ui';

const KINDS = [
  { value: 'SERVICE', label: 'Services (SAC code)' },
  { value: 'PRODUCT', label: 'Products (HSN code)' },
];
const NOUN = { SERVICE: { one: 'service', many: 'services', code: 'SAC' }, PRODUCT: { one: 'product', many: 'products', code: 'HSN' } };

// Tax rules: a draft until the business owner approves it (activating approves the ones in use). An approved rule can't
// change; a new rate is a new dated row.
export default function TaxRulesCard({ setup }) {
  const [editing, setEditing] = useState(null); // { rule?, group? }: new rule, new dated row, or a draft being changed
  const [approving, setApproving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const remove = useDeleteRule();
  const link = useLinkUnlinked();

  function linkAll(group) {
    link.mutate(
      { key: newRequestKey(), groupId: group.groupId },
      {
        onSuccess: ({ result }) => toast.success(`${result.linked} ${NOUN[group.kind].many} linked to ${group.name}`),
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Card
      title="Tax rules"
      actions={setup.canEdit && (
        <Button size="sm" onClick={() => setEditing({})}>
          <Plus size={14} /> Add rule
        </Button>
      )}
    >
      <p className="mb-3 text-sm text-muted">Services and products point to a rule, so nobody chooses a rate at checkout. Each bill uses the rule for its date.</p>
      {setup.groups.length === 0 && <p className="py-4 text-center text-sm text-muted">No tax rules yet.</p>}
      <div className="flex flex-col gap-4">
        {setup.groups.map((group) => {
          const unlinked = setup.unlinked[group.kind] ?? 0;
          return (
            <div key={group.groupId} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {group.name} <span className="text-xs font-normal text-muted">· {NOUN[group.kind].many}</span>
                </p>
                {setup.canEdit && (
                  <div className="flex flex-wrap gap-1">
                    {unlinked > 0 && (
                      <Button size="sm" variant="secondary" loading={link.isPending} onClick={() => linkAll(group)}>
                        Link {unlinked} {unlinked === 1 ? NOUN[group.kind].one : NOUN[group.kind].many} with no rule
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ group })}>Change from a date</Button>
                  </div>
                )}
              </div>
              <ul className="divide-y divide-border text-sm">
                {group.rows.map((rule) => (
                  <li key={rule._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p>
                        {NOUN[group.kind].code} {rule.code} · {percentLabel(rule.rateBps)} {ITC_LABEL[rule.itcType]}{' '}
                        {rule.status === 'DRAFT' ? <Badge tone="yellow">Draft</Badge> : <Badge tone="brown">Approved</Badge>}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDate(rule.from)} to {rule.to ? formatDate(rule.to) : 'now'}
                        {rule.status === 'APPROVED' && rule.approvedByName && ` · ${rule.reviewedBy ? `reviewed by ${rule.reviewedBy}, ` : ''}approved by ${rule.approvedByName}`}
                      </p>
                    </div>
                    {setup.canEdit && rule.status === 'DRAFT' && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => setApproving({ rule, group })}>Approve</Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditing({ rule, group })}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(rule)}>Delete</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {editing && <RuleModal {...editing} onClose={() => setEditing(null)} />}
      {approving && <ApproveModal {...approving} onClose={() => setApproving(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this draft rule?"
        danger
        confirmLabel="Delete"
        loading={remove.isPending}
        message="It was never approved, so no bill used it."
        onConfirm={() =>
          remove.mutate(
            { key: newRequestKey(), _id: deleting._id },
            {
              onSuccess: () => {
                toast.success('Draft rule deleted');
                setDeleting(null);
              },
              onError: (err) => toast.error(err.message),
            }
          )
        }
      />
    </Card>
  );
}

// A new rule (no group), a new dated row of a rule (group), or changes to a draft (rule)
function RuleModal({ rule, group, onClose }) {
  const save = useSaveRule();
  const [key] = useState(newRequestKey);
  const latest = group?.rows[0];
  const [values, setValues] = useState({
    name: rule?.name ?? group?.name ?? '',
    kind: group?.kind ?? 'SERVICE',
    code: rule?.code ?? latest?.code ?? '',
    rateBps: String(rule?.rateBps ?? latest?.rateBps ?? 500),
    itcType: rule?.itcType ?? latest?.itcType ?? 'WITHOUT_ITC',
    from: rule?.from ?? '',
    to: rule?.to ?? '',
  });
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));
  const codeOk = /^\d{4,8}$/.test(values.code.trim());

  function submit() {
    const fields = { code: values.code.trim(), rateBps: Number(values.rateBps), itcType: values.itcType, from: values.from, to: values.to || null };
    let body;
    if (rule) body = { _id: rule._id, name: values.name.trim(), ...fields };
    else if (group) body = { groupId: group.groupId, ...fields };
    else body = { name: values.name.trim(), kind: values.kind, ...fields };
    save.mutate(
      { key, ...body },
      {
        onSuccess: () => {
          toast.success(rule ? 'Draft rule saved' : 'Draft rule added. Approve it to use it.');
          onClose();
        },
      }
    );
  }

  const title = rule ? `Edit ${rule.name}` : group ? `New rate for ${group.name}` : 'Add a tax rule';
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <ModalFooter onClose={onClose} loading={save.isPending} disabled={!codeOk || !values.from || values.name.trim().length < 2} onClick={submit}>
          Save draft
        </ModalFooter>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {group && !rule && <p className="rounded-lg bg-surface p-3 text-sm text-muted sm:col-span-2">Once you approve this, the current row ends the day before it starts. Old bills never change.</p>}
        {!group && (
          <>
            <Input label="Name" placeholder="e.g. Hair care products" value={values.name} onChange={set('name')} />
            <Select label="For" options={KINDS} value={values.kind} onChange={set('kind')} />
          </>
        )}
        {rule && <Input label="Name" value={values.name} onChange={set('name')} />}
        <Input label={`${NOUN[values.kind].code} code`} inputMode="numeric" value={values.code} error={values.code && !codeOk ? '4 to 8 digits' : null} onChange={set('code')} />
        <Select label="GST rate" options={GST_RATE_OPTIONS} value={values.rateBps} onChange={set('rateBps')} />
        <div className="sm:col-span-2">
          <Select label="Input tax credit" options={ITC_OPTIONS} value={values.itcType} onChange={set('itcType')} />
        </div>
        <Input label="From" type="date" value={values.from} onChange={set('from')} />
        <Input label="To (optional)" type="date" min={values.from || undefined} hint="Leave empty until a newer rule takes over" value={values.to} onChange={set('to')} />
        {save.isError && <p className="text-sm text-danger sm:col-span-2">{refusalText(save.error)}</p>}
      </div>
    </Modal>
  );
}

function ApproveModal({ rule, group, onClose }) {
  const approve = useApproveRule();
  const [key] = useState(newRequestKey);
  const [reviewedBy, setReviewedBy] = useState('');

  function submit() {
    approve.mutate(
      { key, _id: rule._id, ...(reviewedBy.trim() && { reviewedBy: reviewedBy.trim() }) },
      {
        onSuccess: () => {
          toast.success('Rule approved');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve ${group.name}`}
      footer={
        <ModalFooter onClose={onClose} loading={approve.isPending} onClick={submit}>
          Approve rule
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          {NOUN[group.kind].code} {rule.code} · {percentLabel(rule.rateBps)} {ITC_LABEL[rule.itcType]}, from {formatDate(rule.from)}
          {rule.to && ` to ${formatDate(rule.to)}`}. Once approved, this row can’t be changed.
        </p>
        <Input label="Who reviewed it? (optional)" placeholder="e.g. CA Mehta" value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} />
        {approve.isError && <p className="text-danger">{refusalText(approve.error)}</p>}
      </div>
    </Modal>
  );
}
