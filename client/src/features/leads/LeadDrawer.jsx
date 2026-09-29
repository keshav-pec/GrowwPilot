import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarCheck, Pencil } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAddLeadNote, useLead, useSaveLead, useSetLeadStatus } from '../../api/leads';
import { LEAD_NEXT_STATUSES, LEAD_STATUS_LABEL, OPEN_LEAD_STATUSES, isOverdue } from '../../lib/leads';
import { formatDateTime, fromLocalInput, toLocalInput } from '../../lib/time';
import { Badge, Button, Drawer, Input, Spinner, Textarea } from '../../components/ui';
import LeadStatusBadge from '../../components/LeadStatusBadge';
import LeadFormModal from './LeadFormModal';

// Details, status buttons, follow-up picker, notes timeline and "Convert to appointment"
export default function LeadDrawer({ leadId, onClose }) {
  const navigate = useNavigate();
  const { activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const leadQuery = useLead(leadId);
  const setStatus = useSetLeadStatus();
  const addNote = useAddLeadNote();
  const saveLead = useSaveLead();
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState(null); // null = not being edited
  const [editing, setEditing] = useState(false);

  const lead = leadQuery.data?.lead;
  const isOpen = lead && OPEN_LEAD_STATUSES.includes(lead.status);

  function changeStatus(status) {
    setStatus.mutate({ _id: lead._id, status }, { onSuccess: () => toast.success(`Marked ${LEAD_STATUS_LABEL[status].toLowerCase()}`), onError: (err) => toast.error(err.message) });
  }

  function saveNote() {
    addNote.mutate({ _id: lead._id, text: note }, { onSuccess: () => setNote(''), onError: (err) => toast.error(err.message) });
  }

  function saveFollowUp() {
    saveLead.mutate(
      { _id: lead._id, nextFollowUpAt: fromLocalInput(followUp, zone) },
      { onSuccess: () => { setFollowUp(null); toast.success('Follow-up saved'); }, onError: (err) => toast.error(err.message) }
    );
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={lead?.name ?? 'Lead'}
        footer={
          lead && (
            <div className="flex w-full flex-wrap justify-end gap-2">
              {isOpen && (
                <Button variant="secondary" className="mr-auto" onClick={() => setEditing(true)}>
                  <Pencil size={16} /> Edit
                </Button>
              )}
              {isOpen && (
                <Button onClick={() => navigate(`/app/leads/${lead._id}/convert`)}>
                  <CalendarCheck size={16} /> Convert to appointment
                </Button>
              )}
            </div>
          )
        }
      >
        {leadQuery.isPending ? (
          <Spinner />
        ) : leadQuery.isError ? (
          <p className="text-sm text-danger">{leadQuery.error.message}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <LeadStatusBadge status={lead.status} />
              {isOverdue(lead) && <Badge tone="orange">Follow-up overdue</Badge>}
            </div>

            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-xs text-muted">Phone</dt><dd>{lead.phone}</dd></div>
              <div><dt className="text-xs text-muted">Source</dt><dd>{lead.source}</dd></div>
              <div><dt className="text-xs text-muted">Interested in</dt><dd>{lead.interestedServiceId?.name ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Assigned to</dt><dd>{lead.assignedToUserId?.name ?? '—'}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted">Created</dt><dd>{formatDateTime(lead.createdAt, zone)}</dd></div>
            </dl>

            {/* Converted: link to the customer it was linked to */}
            {lead.status === 'APPOINTMENT_BOOKED' && lead.customerId && (
              <div className="rounded-lg border border-brown/30 bg-brown/5 p-3">
                Booked and linked to a customer profile.{' '}
                <Link to={`/app/customers/${lead.customerId}`} className="font-medium underline">Open customer</Link>
              </div>
            )}

            {/* Status buttons: only the moves the rules allow */}
            {LEAD_NEXT_STATUSES[lead.status].length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted">Move to</p>
                <div className="flex flex-wrap gap-2">
                  {LEAD_NEXT_STATUSES[lead.status].map((status) => (
                    <Button key={status} size="sm" variant={status === 'LOST' ? 'ghost' : 'secondary'} onClick={() => changeStatus(status)} disabled={setStatus.isPending}>
                      {LEAD_STATUS_LABEL[status]}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-up */}
            {isOpen && (
              <div>
                <p className="mb-1 text-xs text-muted">Next follow-up</p>
                {followUp === null ? (
                  <div className="flex items-center gap-2">
                    <span className={isOverdue(lead) ? 'font-medium text-orange' : ''}>
                      {lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt, zone) : 'Not set'}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setFollowUp(toLocalInput(lead.nextFollowUpAt, zone))}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                    <Button size="sm" onClick={saveFollowUp} loading={saveLead.isPending}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setFollowUp(null)}>Cancel</Button>
                  </div>
                )}
              </div>
            )}

            {/* Notes timeline, newest first */}
            <div>
              <p className="mb-2 text-xs text-muted">Notes</p>
              <div className="mb-3 flex flex-col gap-2">
                <Textarea placeholder="What happened on the call?" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" className="self-end" onClick={saveNote} disabled={!note.trim()} loading={addNote.isPending}>
                  Add note
                </Button>
              </div>
              <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
                {[...lead.notes].reverse().map((n) => (
                  <li key={n._id}>
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    <p className="text-xs text-muted">
                      {n.by?.name ?? 'Someone'} · {formatDateTime(n.at, zone)}
                    </p>
                  </li>
                ))}
                {lead.notes.length === 0 && <li className="text-muted">No notes yet.</li>}
              </ol>
            </div>
          </div>
        )}
      </Drawer>

      {editing && <LeadFormModal lead={lead} onClose={() => setEditing(false)} />}
    </>
  );
}
