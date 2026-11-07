import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { downloadProof, refusalText, useApproveWorksheet, useGstWorksheet, usePrepareWorksheet, useRecordFiling, useSavePortalFigures, useWorksheetTrail } from '../../api/gst';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { formatDate, formatDateTime, formatMonth } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Badge, Button, Card, EmptyState, HEADLINE_TILE, Input, Modal, ModalFooter, PageHeader, PageSpinner, Spinner, StatTile, Textarea } from '../../components/ui';
import { WORKSHEET_STATUS } from './returnStatus';

const HEADS = [['taxable', 'Taxable'], ['igst', 'IGST'], ['cgst', 'CGST'], ['sgst', 'SGST']];
const fail = (err) => toast.error(refusalText(err));
const ARN_SHAPE = /^[A-Za-z0-9]{15}$/;

// The GSTR-3B working sheet: our figures, the portal's and the differences, kept apart.
export default function GstWorksheetPage() {
  const { id } = useParams();
  const query = useGstWorksheet(id);
  if (query.isPending) return <PageSpinner />;
  if (query.isError) return <EmptyState title="Working sheet not found" message={query.error.message} />;
  return <Sheet key={query.data._id} sheet={query.data} />;
}

function Sheet({ sheet }) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(null); // 'portal' | 'approve' | 'file'
  const prepare = usePrepareWorksheet();
  const approve = useApproveWorksheet();
  const status = WORKSHEET_STATUS[sheet.status];
  const live = !sheet.superseded;
  const blockers = sheet.notes.filter((n) => n.severity === 'BLOCKER');
  const warnings = sheet.notes.filter((n) => n.severity !== 'BLOCKER');
  const can = sheet.canWork;
  const filed = sheet.status === 'FILED';
  const editableRows = sheet.rows.filter((r) => r.table !== 'memo');

  const rebuild = () =>
    prepare.mutate(
      { key: newRequestKey(), gstin: sheet.gstin, period: sheet.period },
      {
        onSuccess: ({ worksheetId, revision }) => {
          toast.success(`Revision ${revision} made`);
          navigate(`/app/gst/worksheets/${worksheetId}`);
        },
        onError: fail,
      }
    );
  function doApprove() {
    if (sheet.differences.length > 0) return setAsking('approve');
    approve.mutate({ key: newRequestKey(), _id: sheet._id }, { onSuccess: () => toast.success('Working sheet approved'), onError: fail });
  }

  return (
    <>
      <PageHeader
        title={`GSTR-3B working sheet · ${formatMonth(sheet.period)}`}
        subtitle={<Link to="/app/gst?tab=returns" className="hover:underline">← Returns · <span className="font-mono">{sheet.gstin}</span> · {sheet.legalName}</Link>}
        actions={
          <span className="flex items-center gap-2">
            <span className="text-sm text-muted">Revision {sheet.revision}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
      />

      <div className="flex flex-col gap-4">
        {sheet.superseded && <p className="rounded-lg bg-surface p-3 text-sm text-muted">This is an older revision, kept as it was. A newer one exists below.</p>}
        {live && !filed && sheet.outOfDate && (
          <p className="flex items-start gap-2 rounded-lg bg-orange/10 p-3 text-sm text-orange">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" /> Your tax record or purchases have changed since this revision. Rebuild before you approve.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile {...HEADLINE_TILE} label="Output tax" value={formatMoney(sheet.summary.outputTax)} hint={`On ${formatMoney(sheet.summary.taxable)} taxable`} />
          <StatTile {...HEADLINE_TILE} label="Credit approved" value={formatMoney(sheet.summary.itc)} hint={`${formatMoney(sheet.summary.notClaimed)} not claimed`} />
          <StatTile {...HEADLINE_TILE} label="Tax after credit" value={formatMoney(sheet.summary.afterCredit.igst + sheet.summary.afterCredit.cgst + sheet.summary.afterCredit.sgst)} hint="Before your portal balances. Not the amount to pay." />
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-yellow-soft p-3 text-xs">
          <Info size={14} className="mt-0.5 shrink-0" />
          This works out tax, not payment. It has no interest, late fees or ledger balances, and the app doesn’t know whether tax was paid. What you pay comes from the GST portal. Please have your tax person review this.
        </p>

        {live && can && (
          <Card title="What next">
            <div className="flex flex-wrap gap-2">
              {!filed && <Button variant={sheet.outOfDate || blockers.length > 0 ? 'primary' : 'secondary'} loading={prepare.isPending} onClick={rebuild}>Rebuild</Button>}
              {sheet.status === 'DRAFT' && <Button variant="secondary" onClick={() => setAsking('portal')}>{sheet.portal?.rows ? 'Enter the portal’s figures again' : 'Enter the portal’s figures'}</Button>}
              {sheet.status === 'DRAFT' && <Button disabled={blockers.length > 0 || sheet.outOfDate} loading={approve.isPending} onClick={doApprove}>Approve</Button>}
              {sheet.status === 'APPROVED' && <Button onClick={() => setAsking('file')}>Record filing</Button>}
            </div>
            <p className="mt-2 text-xs text-muted">
              {sheet.status === 'DRAFT' && 'Fix anything listed at its source, then Rebuild. Nobody types over these figures.'}
              {sheet.status === 'APPROVED' && 'Now pay and file on the GST portal, then record the ARN and proof here. GSTR-1 for this month has to be recorded as filed first.'}
              {filed && 'This month’s purchases and credit are locked, and GSTR-1A is closed.'}
            </p>
          </Card>
        )}

        {filed && (
          <Card title="Filing">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 size={16} className="text-brown" /> ARN <span className="font-mono">{sheet.filing.arn}</span> · filed on {formatDate(sheet.filing.filedOn)} · manually confirmed by {sheet.filing.recordedByName}
              <button type="button" className="underline" onClick={() => downloadProof(sheet.filing.proofFileId, sheet.filing.proofName).catch(fail)}>Proof: {sheet.filing.proofName}</button>
            </p>
          </Card>
        )}

        {!filed && (blockers.length > 0 || warnings.length > 0) && (
          <Card title={blockers.length > 0 ? `${blockers.length} to fix before approving` : 'To check'}>
            <ul className="flex flex-col gap-2 text-sm">
              {[...blockers, ...warnings].map((note) => (
                <li key={note.code} className="flex items-start gap-2">
                  {note.severity === 'BLOCKER' ? <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0 text-orange" />}
                  <span>{note.message} {note.link && <Link to={note.link} className="font-medium underline">Open</Link>}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {sheet.differences.length > 0 && (
          <Card title="Differences with the portal">
            <ul className="flex flex-col gap-2 text-sm">
              {sheet.differences.map((d) => (
                <li key={d.key}>
                  <p className="font-medium">{d.key} {d.label}</p>
                  <p className="text-orange">{HEADS.filter(([k]) => d.difference[k]).map(([k, label]) => `${label} ${formatMoney(d.difference[k])}`).join(' · ')}</p>
                  <p className="text-xs text-muted">{d.fix}</p>
                </li>
              ))}
            </ul>
            {sheet.differenceNote && <p className="mt-2 text-sm">Approved with these differences: {sheet.differenceNote}</p>}
          </Card>
        )}

        <Card title="Our figures">
          <div className="flex flex-col gap-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-1 pr-2 font-medium">Row</th>
                    {HEADS.map(([k, label]) => <th key={k} className="py-1 pr-2 text-right font-medium">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row) => <SheetRow key={row.key} sheetId={sheet._id} row={row} portal={sheet.portal?.rows?.[row.key]} />)}
                </tbody>
              </table>
            </div>
            {sheet.portal?.rows && <p className="mt-2 text-xs text-muted">Grey figures are what the portal showed, typed in by {sheet.portal.enteredByName} on {formatDateTime(sheet.portal.enteredAt)}. They never replace ours.</p>}
          </div>
        </Card>

        <Card title="Revisions">
          <ul className="flex flex-col gap-1 text-sm">
            {sheet.revisions.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center gap-2">
                <Link to={`/app/gst/worksheets/${r._id}`} className={r._id === sheet._id ? 'font-semibold' : 'underline'}>Revision {r.revision}</Link>
                <Badge tone={WORKSHEET_STATUS[r.status].tone}>{WORKSHEET_STATUS[r.status].label}</Badge>
                <span className="text-xs text-muted">{formatDateTime(r.createdAt)} · {r.preparedByName}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {asking === 'portal' && <PortalModal sheet={sheet} rows={editableRows} onClose={() => setAsking(null)} />}
      {asking === 'approve' && <ApproveWithNote sheet={sheet} onClose={() => setAsking(null)} />}
      {asking === 'file' && <FilingModal sheet={sheet} onClose={() => setAsking(null)} />}
    </>
  );
}

// "3.2", "4A(5)"... A row that isn't on the form has no number
const RowName = ({ row }) => (row.table === 'memo' ? null : <span className="font-medium">{row.key.split(':')[0]}</span>);

function SheetRow({ sheetId, row, portal }) {
  const [open, setOpen] = useState(false);
  const opens = row.count > 0;
  const trail = useWorksheetTrail(sheetId, open ? row.key : null);
  return (
    <>
      <tr className="border-b border-border align-top">
        <td className="py-1 pr-2">
          {opens ? (
            <button type="button" className="flex items-start gap-1 text-left hover:text-brown" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
              <span><RowName row={row} /> {row.label} <span className="text-xs text-muted">· {row.count}</span></span>
            </button>
          ) : (
            <span className="pl-5"><RowName row={row} /> {row.label}</span>
          )}
        </td>
        {HEADS.map(([k]) => (
          <td key={k} className="py-1 pr-2 text-right">
            {row.table !== '3.1' && row.table !== '3.2' && k === 'taxable' ? '' : formatMoney(row[k])}
            {portal && !(row.table === '4' && k === 'taxable') && row.table !== 'memo' && <span className="block text-xs text-muted">{formatMoney(portal[k] ?? 0)}</span>}
          </td>
        ))}
      </tr>
      {open && (
        <tr className="border-b border-border bg-surface">
          <td colSpan={5} className="px-5 py-2 text-xs">
            {trail.isPending && <Spinner size={14} />}
            {trail.data?.entries?.map((e) => (
              <p key={e._id} className="flex justify-between gap-2">
                <Link to={e.link} className="font-mono underline">{e.documentNumber}</Link>
                <span className="text-muted">{formatDate(e.taxDate)} · {e.customerName} · {formatMoney(e.total)}</span>
              </p>
            ))}
            {trail.data?.decisions?.map((d) => (
              <p key={d._id} className="flex justify-between gap-2">
                <span className="font-mono">{d.documentNumber}</span>
                <span className="text-muted">{d.supplierName} · {formatMoney(d.eligible.igst + d.eligible.cgst + d.eligible.sgst)} claimed, {formatMoney(d.notEligible.igst + d.notEligible.cgst + d.notEligible.sgst)} not. {d.reason} · {d.decidedByName}</span>
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

// The figures are typed as the portal shows them. They sit beside ours and never replace them.
function PortalModal({ sheet, rows, onClose }) {
  const save = useSavePortalFigures();
  const [key] = useState(newRequestKey);
  const [values, setValues] = useState(() => Object.fromEntries(rows.map((r) => [r.key, Object.fromEntries(HEADS.map(([k]) => [k, sheet.portal?.rows?.[r.key]?.[k] != null ? String(sheet.portal.rows[r.key][k] / 100) : '']))])));
  const set = (rowKey, head, text) => setValues((v) => ({ ...v, [rowKey]: { ...v[rowKey], [head]: text } }));
  const valid = Object.values(values).every((row) => Object.values(row).every((t) => t.trim() === '' || isValidRupees(t)));

  function submit() {
    const entered = {};
    for (const [rowKey, row] of Object.entries(values)) {
      if (Object.values(row).every((t) => t.trim() === '')) continue;
      entered[rowKey] = Object.fromEntries(HEADS.map(([k]) => [k, row[k].trim() ? toPaise(row[k]) : 0]));
    }
    save.mutate({ key, _id: sheet._id, rows: entered }, { onSuccess: () => { toast.success('Portal figures saved'); onClose(); } });
  }

  return (
    <Modal open onClose={onClose} title="The portal’s figures" footer={<ModalFooter onClose={onClose} disabled={!valid} loading={save.isPending} onClick={submit}>Save</ModalFooter>}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">Copy these exactly from GSTR-3B on the portal. Don’t change them to match the app: a difference shows you where to look.</p>
        {rows.map((r) => (
          <fieldset key={r.key} className="flex flex-col gap-1">
            <legend className="font-medium">{r.key.split(':')[0]} {r.label}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {HEADS.filter(([k]) => !(r.table === '4' && k === 'taxable')).map(([k, label]) => (
                <Input key={k} aria-label={`${r.key} ${label}`} placeholder={label} inputMode="decimal" value={values[r.key][k]} onChange={(e) => set(r.key, k, e.target.value)} />
              ))}
            </div>
          </fieldset>
        ))}
        {save.isError && <p className="text-danger">{refusalText(save.error)}</p>}
      </div>
    </Modal>
  );
}

function ApproveWithNote({ sheet, onClose }) {
  const approve = useApproveWorksheet();
  const [key] = useState(newRequestKey);
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title="Approve with differences" footer={<ModalFooter onClose={onClose} disabled={note.trim().length < 3} loading={approve.isPending} onClick={() => approve.mutate({ key, _id: sheet._id, differenceNote: note.trim() }, { onSuccess: () => { toast.success('Working sheet approved'); onClose(); } })}>Approve</ModalFooter>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">This sheet differs from the portal. It’s usually better to fix the source first. If you are sure, say why.</p>
        <Textarea label="Why are you approving it?" value={note} onChange={(e) => setNote(e.target.value)} />
        {approve.isError && <p className="text-danger">{refusalText(approve.error)}</p>}
      </div>
    </Modal>
  );
}

function FilingModal({ sheet, onClose }) {
  const record = useRecordFiling();
  const [key] = useState(newRequestKey);
  const [arn, setArn] = useState('');
  const [filedOn, setFiledOn] = useState('');
  const [proof, setProof] = useState(null);
  const ready = ARN_SHAPE.test(arn.trim()) && filedOn && proof;
  return (
    <Modal open onClose={onClose} title="Record GSTR-3B filing" footer={<ModalFooter onClose={onClose} disabled={!ready} loading={record.isPending} onClick={() => record.mutate({ key, path: `worksheets/${sheet._id}`, arn: arn.trim().toUpperCase(), filedOn, proof }, { onSuccess: () => { toast.success('Recorded as filed, manually confirmed'); onClose(); } })}>Record filing</ModalFooter>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Only do this after filing on the GST portal. It locks this month’s purchases and credit, and closes GSTR-1A. It doesn’t record any payment.</p>
        <Input label="ARN" maxLength={15} value={arn} onChange={(e) => setArn(e.target.value)} error={arn && !ARN_SHAPE.test(arn.trim()) ? '15 letters and digits' : null} />
        <Input label="Filed on" type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
        <Input label="Proof from the portal" type="file" accept="application/pdf,image/jpeg,image/png" hint="The acknowledgement, as a PDF or picture, up to 5 MB" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
        {record.isError && <p className="text-sm text-danger">{refusalText(record.error)}</p>}
      </div>
    </Modal>
  );
}
