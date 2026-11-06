import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { refusalText, useAddRegistration, useLinkBranch } from '../../api/gst';
import { GST_STATES } from '../../lib/billing';
import { formatDate } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Badge, Button, Card, Input, Modal, ModalFooter, Select, Table } from '../../components/ui';
import CheckboxList from '../../components/CheckboxList';

const dates = (row) => `${formatDate(row.from)} to ${row.to ? formatDate(row.to) : 'now'}`;
const inUse = (row) => !row.to;
const usable = (setup) => setup.branches.filter((b) => b.status !== 'archived');

// GSTINs with the dates they apply. A row is never rewritten: replacing a GSTIN closes it and adds a new one.
export default function RegistrationsCard({ setup }) {
  const [adding, setAdding] = useState(null); // null | { replacing: row or null }
  const [linking, setLinking] = useState(null); // the registration a branch is being linked to

  const columns = [
    {
      key: 'gstin',
      header: 'GSTIN',
      render: (r) => (
        <div>
          <p className="font-mono">{r.gstin}</p>
          <p className="text-xs text-muted">{r.legalName}</p>
        </div>
      ),
    },
    { key: 'state', header: 'State', render: (r) => `${r.stateName} (${r.stateCode})` },
    { key: 'filing', header: 'Filing', render: () => 'Monthly' },
    { key: 'dates', header: 'Dates', render: (r) => (inUse(r) ? dates(r) : <span className="text-muted">{dates(r)}</span>) },
    {
      key: 'branches',
      header: 'Branches',
      render: (r) => (
        <ul>
          {r.branches.map((link) => (
            <li key={`${link.branchId}:${link.from}`} className={link.to ? 'text-muted' : ''}>
              {link.name}
              {(link.from !== r.from || link.to) && <span className="text-xs"> · {dates(link)}</span>}
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        setup.canEdit && inUse(r) ? (
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={() => setLinking(r)}>Link a branch</Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding({ replacing: r })}>Replace GSTIN</Button>
          </div>
        ) : (
          !inUse(r) && <Badge>Ended</Badge>
        ),
    },
  ];

  return (
    <Card
      title="GST registrations"
      actions={setup.canEdit && (
        <Button size="sm" onClick={() => setAdding({ replacing: null })}>
          <Plus size={14} /> Add registration
        </Button>
      )}
    >
      <p className="mb-3 text-sm text-muted">Each branch has one GSTIN on any given date. A GSTIN isn’t checked with the government, only for its format and state.</p>
      <Table columns={columns} rows={setup.registrations} empty={<p className="py-4 text-center text-sm text-muted">No registrations yet. Add your GSTIN.</p>} />
      {adding && <RegistrationModal setup={setup} replacing={adding.replacing} onClose={() => setAdding(null)} />}
      {linking && <LinkBranchModal setup={setup} registration={linking} onClose={() => setLinking(null)} />}
    </Card>
  );
}

function RegistrationModal({ setup, replacing, onClose }) {
  const add = useAddRegistration();
  const [key] = useState(newRequestKey);
  const [values, setValues] = useState({
    gstin: '',
    legalName: replacing?.legalName ?? '',
    stateCode: replacing?.stateCode ?? '',
    from: setup.today,
    branchIds: replacing ? replacing.branches.filter((link) => !link.to).map((link) => link.branchId) : [],
  });
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));
  // The server names the field that is wrong
  const fieldError = (field) => (add.error?.details?.field === field ? add.error.message : null);
  const otherError = add.error && !['gstin', 'stateCode', 'legalName', 'from'].includes(add.error.details?.field) ? refusalText(add.error) : null;

  function submit() {
    add.mutate(
      { key, ...values, move: Boolean(replacing) },
      {
        onSuccess: () => {
          toast.success(replacing ? 'GSTIN replaced from that date' : 'Registration added');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={replacing ? `Replace ${replacing.gstin}` : 'Add a GST registration'}
      footer={
        <ModalFooter onClose={onClose} loading={add.isPending} disabled={values.gstin.length !== 15 || !values.stateCode || !values.legalName.trim() || !values.from || values.branchIds.length === 0} onClick={submit}>
          Save
        </ModalFooter>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {replacing && <p className="rounded-lg bg-surface p-3 text-sm text-muted sm:col-span-2">The old row stays and ends the day before the new date. Bills already issued keep their GSTIN.</p>}
        <Input
          label="GSTIN"
          maxLength={15}
          value={values.gstin}
          error={fieldError('gstin')}
          onChange={(e) => {
            const gstin = e.target.value.toUpperCase().replace(/\s/g, '');
            setValues((v) => ({ ...v, gstin, ...(GST_STATES.some((s) => s.value === gstin.slice(0, 2)) ? { stateCode: gstin.slice(0, 2) } : {}) }));
          }}
        />
        <Input label="Legal name (as on the registration)" value={values.legalName} error={fieldError('legalName')} onChange={set('legalName')} />
        <Select label="State" placeholder="Choose a state" options={GST_STATES} value={values.stateCode} error={fieldError('stateCode')} onChange={set('stateCode')} />
        <Input label="Start date" type="date" value={values.from} error={fieldError('from')} onChange={set('from')} />
        <div className="sm:col-span-2">
          <CheckboxList label="Branches" items={usable(setup)} value={values.branchIds} onChange={(branchIds) => setValues((v) => ({ ...v, branchIds }))} />
        </div>
        {otherError && <p className="text-sm text-danger sm:col-span-2">{otherError}</p>}
      </div>
    </Modal>
  );
}

function LinkBranchModal({ setup, registration, onClose }) {
  const link = useLinkBranch();
  const [key] = useState(newRequestKey);
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState(setup.today);
  const [move, setMove] = useState(false);
  const here = registration.branches.filter((l) => !l.to).map((l) => l.branchId);
  const options = usable(setup).filter((b) => !here.includes(b._id)).map((b) => ({ value: b._id, label: b.name }));

  function submit() {
    link.mutate(
      { key, registrationId: registration._id, branchId, from, move },
      {
        onSuccess: () => {
          toast.success('Branch linked');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Link a branch to ${registration.gstin}`}
      footer={
        <ModalFooter onClose={onClose} loading={link.isPending} disabled={!branchId || !from} onClick={submit}>
          Link branch
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        <Select label="Branch" placeholder="Choose a branch" options={options} value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        <Input label="From" type="date" min={registration.from} value={from} onChange={(e) => setFrom(e.target.value)} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 accent-gold" checked={move} onChange={(e) => setMove(e.target.checked)} />
          <span>This branch is moving from another GSTIN. End that one the day before.</span>
        </label>
        {link.isError && <p className="text-sm text-danger">{refusalText(link.error)}</p>}
      </div>
    </Modal>
  );
}
