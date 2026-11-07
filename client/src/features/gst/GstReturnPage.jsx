import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Download, Info, TriangleAlert } from 'lucide-react';
import { downloadProof, downloadReview, refusalText, useApproveReturn, useCreateAdjustment, useExportFile, useGstReturn, usePrepareReturn, useRecordFiling, useRejectReturn, useReturnTrail } from '../../api/gst';
import { formatMoney } from '../../lib/money';
import { formatDate, formatDateTime, formatMonth } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Badge, Button, Card, EmptyState, HEADLINE_TILE, Input, Modal, ModalFooter, PageHeader, PageSpinner, Spinner, StatTile, Textarea } from '../../components/ui';
import { ADJUSTMENT_STATUS, RETURN_STATUS } from './returnStatus';

const fail = (err) => toast.error(refusalText(err));

// One revision of a GSTR-1: what to fix, the tables with the bills behind each figure, and the way from Approve to Record filing.
export default function GstReturnPage() {
  const { id } = useParams();
  const query = useGstReturn(id);
  if (query.isPending) return <PageSpinner />;
  if (query.isError) return <EmptyState title="Return not found" message={query.error.message} />;
  return <ReturnScreen key={query.data._id} found={query.data} />;
}

function ReturnScreen({ found }) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(null); // 'file' | 'reject' | 'adjust' | { adjustmentId }
  const prepare = usePrepareReturn();
  const approve = useApproveReturn();
  const exportFile = useExportFile();
  const status = RETURN_STATUS[found.status];
  const blockers = found.issues.filter((i) => i.severity === 'BLOCKER');
  const warnings = found.issues.filter((i) => i.severity !== 'BLOCKER');
  const live = !found.superseded;
  const filed = found.status === 'FILED';
  const can = found.canWork;

  const rebuild = () =>
    prepare.mutate(
      { key: newRequestKey(), gstin: found.gstin, period: found.period },
      {
        onSuccess: ({ returnId, revision }) => {
          toast.success(`Revision ${revision} made`);
          navigate(`/app/gst/returns/${returnId}`);
        },
        onError: fail,
      }
    );

  return (
    <>
      <PageHeader
        title={`GSTR-1 · ${formatMonth(found.period)}`}
        subtitle={
          <Link to="/app/gst?tab=returns" className="hover:underline">
            ← Returns · <span className="font-mono">{found.gstin}</span> · {found.legalName}
          </Link>
        }
        actions={
          <span className="flex items-center gap-2">
            <span className="text-sm text-muted">Revision {found.revision}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
      />

      <div className="flex flex-col gap-4">
        {found.superseded && <p className="rounded-lg bg-surface p-3 text-sm text-muted">This is an older revision, kept as it was. A newer one exists below.</p>}
        {live && !filed && found.outOfDate && (
          <p className="flex items-start gap-2 rounded-lg bg-orange/10 p-3 text-sm text-orange">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" /> The tax record has changed since this revision was prepared. Rebuild before you approve or file.
          </p>
        )}
        {live && !filed && (
          <p className="flex items-start gap-2 rounded-lg bg-yellow-soft p-3 text-xs">
            <Info size={14} className="mt-0.5 shrink-0" />
            The app’s file layout hasn’t been confirmed with the GST portal yet. After uploading, check the portal’s preview against these figures before you file, and have your tax person review them.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile {...HEADLINE_TILE} label="Net taxable" value={formatMoney(found.totals.taxable)} />
          <StatTile {...HEADLINE_TILE} label="Net tax" value={formatMoney(found.totals.tax)} hint={`CGST ${formatMoney(found.totals.cgst)} · SGST ${formatMoney(found.totals.sgst)} · IGST ${formatMoney(found.totals.igst)}`} />
          <StatTile {...HEADLINE_TILE} label="Entries read" value={found.entryCount} hint={`As of ${formatDateTime(found.cutoffAt)}. ${found.excluded.length} left out of the tables.`} />
        </div>

        {live && can && (
          <Card title="What next">
            <div className="flex flex-wrap items-center gap-2">
              {!filed && (
                <Button variant={found.status === 'NEEDS_FIXING' || found.status === 'REJECTED' || found.outOfDate ? 'primary' : 'secondary'} loading={prepare.isPending} onClick={rebuild}>
                  Rebuild
                </Button>
              )}
              {found.status === 'READY' && (
                <Button loading={approve.isPending} disabled={found.outOfDate} onClick={() => approve.mutate({ key: newRequestKey(), _id: found._id }, { onSuccess: () => toast.success('Approved. This revision can’t change now.'), onError: fail })}>
                  Approve
                </Button>
              )}
              {['APPROVED', 'EXPORTED', 'REJECTED', 'FILED'].includes(found.status) && (
                <Button variant={found.status === 'APPROVED' ? 'primary' : 'secondary'} loading={exportFile.isPending} onClick={() => exportFile.mutate({ path: `returns/${found._id}` }, { onError: fail })}>
                  <Download size={16} /> Download file
                </Button>
              )}
              {found.status === 'EXPORTED' && (
                <>
                  <Button disabled={found.outOfDate} onClick={() => setAsking('file')}>Record filing</Button>
                  <Button variant="secondary" onClick={() => setAsking('reject')}>Portal rejected it</Button>
                </>
              )}
              {filed && !found.gstr3b?.arn && (
                <Link to="/app/gst?tab=returns" className="text-sm text-brown underline">GSTR-3B working sheet</Link>
              )}
              {filed && <Button variant="secondary" onClick={() => setAsking('adjust')}>Create adjustment case</Button>}
            </div>
            <p className="mt-2 text-xs text-muted">
              {found.status === 'EXPORTED' && 'Downloading isn’t filing. Upload the file on the GST portal, check its preview, and file there. Then record the ARN and proof here.'}
              {found.status === 'NEEDS_FIXING' && 'Fix what is listed at its source, then Rebuild. The figures here can’t be typed over.'}
              {found.status === 'READY' && 'Approving locks this revision. If anything changes later, a new revision follows and this one is kept.'}
              {found.status === 'REJECTED' && 'Fix what the portal listed at its source, then Rebuild.'}
              {found.status === 'APPROVED' && 'Download the file to upload it on the GST portal.'}
              {filed && 'This month is locked. A correction goes through an adjustment case.'}
            </p>
          </Card>
        )}

        {filed && (
          <Card title="Filing">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 size={16} className="text-brown" /> ARN <span className="font-mono">{found.filing.arn}</span> · filed on {formatDate(found.filing.filedOn)} · manually confirmed by {found.filing.recordedByName}
              <button type="button" className="underline" onClick={() => downloadProof(found.filing.proofFileId, found.filing.proofName).catch(fail)}>Proof: {found.filing.proofName}</button>
            </p>
            {found.gstr3b?.arn && <p className="mt-1 text-sm text-muted">GSTR-3B: ARN <span className="font-mono">{found.gstr3b.arn}</span>, filed on {formatDate(found.gstr3b.filedOn)}. GSTR-1A is closed for this month.</p>}
          </Card>
        )}

        {found.leftOut?.length > 0 && (
          <Card title="Not in this filed return">
            <ul className="flex flex-col gap-1 text-sm">
              {found.leftOut.map((e) => (
                <li key={e._id} className="flex justify-between gap-2">
                  <Link to={e.link} className="font-mono underline">{e.documentNumber}</Link>
                  <span>{formatMoney(e.total)}</span>
                </li>
              ))}
            </ul>
            {can && <p className="mt-2 text-xs text-muted">Create an adjustment case to report these.</p>}
          </Card>
        )}

        {found.adjustments?.length > 0 && (
          <Card title="Adjustment cases">
            <ul className="flex flex-col gap-3 text-sm">
              {found.adjustments.map((a) => (
                <li key={a._id} className="rounded-lg border border-border p-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.route === 'GSTR_1A' ? 'GSTR-1A' : 'Later-period amendment'}</span>
                    <Badge tone={ADJUSTMENT_STATUS[a.status].tone}>{ADJUSTMENT_STATUS[a.status].label}</Badge>
                    {a.totals && <span className="text-muted">{formatMoney(a.totals.taxable)} taxable · {formatMoney(a.totals.tax)} tax</span>}
                  </p>
                  <p className="text-xs text-muted">{a.reason} · by {a.createdByName}</p>
                  {a.issues?.map((i) => <p key={i.code} className="mt-1 text-xs text-orange">{i.message}</p>)}
                  {a.filing?.arn && <p className="mt-1 text-xs">ARN <span className="font-mono">{a.filing.arn}</span>, filed on {formatDate(a.filing.filedOn)}, manually confirmed</p>}
                  {can && ['DRAFT', 'EXPORTED'].includes(a.status) && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => exportFile.mutate({ path: `adjustments/${a._id}` }, { onError: fail })}><Download size={14} /> Download file</Button>
                      {a.status === 'EXPORTED' && <Button size="sm" onClick={() => setAsking({ adjustmentId: a._id })}>Record filing</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {found.rejection?.rows?.length > 0 && (
          <Card title="What the portal said">
            <ul className="flex flex-col gap-1 text-sm">
              {found.rejection.rows.map((r, i) => (
                <li key={i}>
                  {r.message} {r.link && <Link to={r.link} className="font-medium underline">Open {r.documentNumber}</Link>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!filed && (blockers.length > 0 || warnings.length > 0) && (
          <Card title={blockers.length > 0 ? `${blockers.length} to fix` : 'To check'}>
            <ul className="flex flex-col gap-2 text-sm">
              {[...blockers, ...warnings].map((issue, i) => (
                <li key={i} className="flex items-start gap-2">
                  {issue.severity === 'BLOCKER' ? <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0 text-orange" />}
                  <span>
                    {issue.message} {issue.link && <Link to={issue.link} className="font-medium underline">Open</Link>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Tables found={found} />

        {found.excluded.length > 0 && (
          <Card title="Left out of the tables">
            <ul className="flex flex-col gap-1 text-sm">
              {found.excluded.map((e) => <li key={String(e.entryId)}><span className="font-mono text-xs">{e.documentNumber}</span> <span className="text-muted">· {e.reason}</span></li>)}
            </ul>
          </Card>
        )}

        <Card
          title="Review copies and revisions"
          actions={
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => downloadReview(found._id, 'csv').catch(fail)}><Download size={14} /> CSV</Button>
              <Button size="sm" variant="secondary" onClick={() => downloadReview(found._id, 'pdf').catch(fail)}><Download size={14} /> PDF</Button>
            </span>
          }
        >
          <ul className="flex flex-col gap-1 text-sm">
            {found.revisions.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center gap-2">
                <Link to={`/app/gst/returns/${r._id}`} className={r._id === found._id ? 'font-semibold' : 'underline'}>Revision {r.revision}</Link>
                <Badge tone={RETURN_STATUS[r.status].tone}>{RETURN_STATUS[r.status].label}</Badge>
                <span className="text-xs text-muted">{formatDateTime(r.createdAt)} · {r.preparedByName}</span>
              </li>
            ))}
          </ul>
          {found.exports?.length > 0 && <p className="mt-2 text-xs text-muted">File downloaded {found.exports.length} time{found.exports.length === 1 ? '' : 's'}, last by {found.exports.at(-1).byName} on {formatDateTime(found.exports.at(-1).at)}.</p>}
        </Card>
      </div>

      {asking === 'file' && <FilingModal title="Record filing" path={`returns/${found._id}`} onClose={() => setAsking(null)} />}
      {asking?.adjustmentId && <FilingModal title="Record GSTR-1A filing" path={`adjustments/${asking.adjustmentId}`} onClose={() => setAsking(null)} />}
      {asking === 'reject' && <RejectModal found={found} onClose={() => setAsking(null)} />}
      {asking === 'adjust' && <AdjustModal found={found} onClose={() => setAsking(null)} />}
    </>
  );
}

// The tables, each row opening the entries behind it
function Tables({ found }) {
  const groups = new Map();
  for (const row of found.review) {
    if (!groups.has(row.table)) groups.set(row.table, []);
    groups.get(row.table).push(row);
  }
  if (groups.size === 0) return <EmptyState title="Nothing this month" message="The tax record has nothing for this GSTIN this month." />;
  return (
    <Card title="Tables">
      <div className="flex flex-col gap-5">
        {[...groups].map(([table, rows]) => (
          <section key={table}>
            <h4 className="mb-1 text-sm font-medium">{table}</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-1 pr-2 font-medium">Details</th>
                    <th className="py-1 pr-2 font-medium">Rate</th>
                    <th className="py-1 pr-2 text-right font-medium">Taxable</th>
                    <th className="py-1 pr-2 text-right font-medium">CGST</th>
                    <th className="py-1 pr-2 text-right font-medium">SGST</th>
                    <th className="py-1 pr-2 text-right font-medium">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => <TableRow key={`${row.row}-${i}`} returnId={found._id} row={row} count={found.counts[row.row]} />)}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}

function TableRow({ returnId, row, count }) {
  const [open, setOpen] = useState(false);
  const trail = useReturnTrail(returnId, open ? row.row : null);
  const money = (key) => (row[key] === undefined ? '' : <span className={row[key] < 0 ? 'text-orange' : ''}>{formatMoney(row[key])}</span>);
  const details = [row.who, row.number, row.date && formatDate(row.date), row.code && `${row.code}`, row.unit && `${row.unit}`, row.taxable !== undefined && row.unit && row.unit !== 'NA' ? `qty ${row.qty}` : null, row.taxable === undefined ? row.qty : null].filter(Boolean).join(' · ');
  return (
    <>
      <tr className="border-b border-border align-top">
        <td className="py-1 pr-2">
          <button type="button" className="flex items-start gap-1 text-left hover:text-brown" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
            <span>{details}{count > 1 && <span className="text-xs text-muted"> · {count} documents</span>}</span>
          </button>
        </td>
        <td className="py-1 pr-2">{row.rate}</td>
        <td className="py-1 pr-2 text-right">{money('taxable')}</td>
        <td className="py-1 pr-2 text-right">{money('cgst')}</td>
        <td className="py-1 pr-2 text-right">{money('sgst')}</td>
        <td className="py-1 pr-2 text-right">{money('igst')}</td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-surface">
          <td colSpan={6} className="px-5 py-2">
            {trail.isPending && <Spinner size={14} />}
            {trail.isError && <p className="text-xs text-danger">{trail.error.message}</p>}
            {trail.data && (
              <ul className="flex flex-col gap-0.5 text-xs">
                {trail.data.entries.map((e) => (
                  <li key={e._id} className="flex justify-between gap-2">
                    <Link to={e.link} className="font-mono underline">{e.documentNumber}</Link>
                    <span className="text-muted">{formatDate(e.taxDate)} · {e.customerName} · {formatMoney(e.total)}</span>
                  </li>
                ))}
                {trail.data.total > trail.data.entries.length && <li className="text-muted">{trail.data.total - trail.data.entries.length} more at other branches</li>}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const ARN_SHAPE = /^[A-Za-z0-9]{15}$/;

function FilingModal({ title, path, onClose }) {
  const record = useRecordFiling();
  const [key] = useState(newRequestKey);
  const [arn, setArn] = useState('');
  const [filedOn, setFiledOn] = useState('');
  const [proof, setProof] = useState(null);
  const ready = ARN_SHAPE.test(arn.trim()) && filedOn && proof;

  function submit() {
    record.mutate({ key, path, arn: arn.trim().toUpperCase(), filedOn, proof }, { onSuccess: () => { toast.success('Recorded as filed, manually confirmed'); onClose(); } });
  }

  return (
    <Modal open onClose={onClose} title={title} footer={<ModalFooter onClose={onClose} disabled={!ready} loading={record.isPending} onClick={submit}>Record filing</ModalFooter>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Only do this after filing on the GST portal. It will show as manually confirmed, and the month locks.</p>
        <Input label="ARN" maxLength={15} value={arn} onChange={(e) => setArn(e.target.value)} error={arn && !ARN_SHAPE.test(arn.trim()) ? '15 letters and digits' : null} />
        <Input label="Filed on" type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
        <Input label="Proof from the portal" type="file" accept="application/pdf,image/jpeg,image/png" hint="The acknowledgement, as a PDF or picture, up to 5 MB" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
        {record.isError && <p className="text-sm text-danger">{refusalText(record.error)}</p>}
      </div>
    </Modal>
  );
}

function RejectModal({ found, onClose }) {
  const reject = useRejectReturn();
  const [key] = useState(newRequestKey);
  const [text, setText] = useState('');
  return (
    <Modal open onClose={onClose} title="The portal rejected the upload" footer={<ModalFooter onClose={onClose} disabled={text.trim().length < 3} loading={reject.isPending} onClick={() => reject.mutate({ key, _id: found._id, text }, { onSuccess: () => { toast.success('Marked as rejected'); onClose(); } })}>Mark as rejected</ModalFooter>}>
      <Textarea label="What the portal said" hint="One error per line. Lines with a bill number link to that bill." value={text} onChange={(e) => setText(e.target.value)} />
      {reject.isError && <p className="mt-2 text-sm text-danger">{refusalText(reject.error)}</p>}
    </Modal>
  );
}

function AdjustModal({ found, onClose }) {
  const create = useCreateAdjustment();
  const [key] = useState(newRequestKey);
  const [reason, setReason] = useState('');
  const count = found.leftOut?.length ?? 0;
  const closed = Boolean(found.gstr3b?.arn);
  return (
    <Modal open onClose={onClose} title="Create adjustment case" footer={<ModalFooter onClose={onClose} disabled={reason.trim().length < 3} loading={create.isPending} onClick={() => create.mutate({ key, _id: found._id, reason }, { onSuccess: () => { toast.success('Case created'); onClose(); } })}>Create case</ModalFooter>}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">
          {closed ? 'GSTR-3B for this month is filed, so GSTR-1A is closed. This case goes to your tax person as an amendment in a later month.' : count > 0 ? `This makes a GSTR-1A file with the ${count} document${count === 1 ? '' : 's'} left out of the filed return. The filed return isn’t changed.` : 'Nothing was left out of the filed return, so this case goes to your tax person to decide how to correct it.'}
        </p>
        <Textarea label="What needs correcting" value={reason} onChange={(e) => setReason(e.target.value)} />
        {create.isError && <p className="text-danger">{refusalText(create.error)}</p>}
      </div>
    </Modal>
  );
}
