import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useSetAppointmentStatus } from '../../api/appointments';
import { NEXT_STEP, STATUS_LABEL, getAlert } from '../../lib/appointments';
import { formatMoney } from '../../lib/money';
import { formatDateTime, formatTime } from '../../lib/time';
import { Badge, Button, ConfirmDialog, Drawer, Textarea } from '../../components/ui';
import AppointmentStatusBadge from '../../components/AppointmentStatusBadge';

// Everything about one appointment, plus its actions (next step, edit, cancel, checkout)
export default function AppointmentDrawer({ appointment, onClose }) {
  const navigate = useNavigate();
  const { activeBranch } = useAuth();
  const zone = activeBranch?.timezone;
  const setStatus = useSetAppointmentStatus();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!appointment) return null;
  const { status } = appointment;
  const next = NEXT_STEP[status];
  const alert = getAlert(appointment);

  function changeStatus(newStatus, extra = {}) {
    setStatus.mutate(
      { _id: appointment._id, status: newStatus, ...extra },
      {
        onSuccess: () => {
          toast.success(`Marked ${STATUS_LABEL[newStatus].toLowerCase()}`);
          setCancelOpen(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={appointment.customerSnapshot.name}
        footer={
          <div className="flex w-full flex-wrap justify-end gap-2">
            {['BOOKED', 'ARRIVED'].includes(status) && (
              <Button variant="ghost" className="mr-auto" onClick={() => setCancelOpen(true)}>
                Cancel booking
              </Button>
            )}
            {status === 'BOOKED' && (
              <Button variant="secondary" onClick={() => navigate(`/app/appointments/${appointment._id}/edit`)}>
                Edit / reschedule
              </Button>
            )}
            {next && (
              <Button onClick={() => changeStatus(next.status)} loading={setStatus.isPending}>
                {next.label}
              </Button>
            )}
            {status === 'COMPLETED' &&
              (appointment.invoiceId ? (
                <Button variant="secondary" onClick={() => navigate(`/app/invoices/${appointment.invoiceId}`)}>
                  View invoice
                </Button>
              ) : (
                <Button onClick={() => navigate(`/app/checkout/${appointment._id}`)}>Checkout</Button>
              ))}
          </div>
        }
      >
        <div className="flex flex-col gap-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <AppointmentStatusBadge status={status} />
            {appointment.invoiceId && <Badge tone="brown">Paid</Badge>}
            {alert && <Badge tone="orange">{alert}</Badge>}
          </div>

          <div>
            <p className="text-muted">Phone</p>
            <p>{appointment.customerSnapshot.phone}</p>
          </div>

          <div>
            <p className="text-muted">When</p>
            <p>
              {formatDateTime(appointment.startAt, zone)} – {formatTime(appointment.endAt, zone)}
            </p>
          </div>

          <div>
            <p className="mb-1 text-muted">Services</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {appointment.items.map((item) => (
                <li key={item._id} className="flex justify-between gap-2 px-3 py-2">
                  <div>
                    <p className="font-medium">{item.serviceName}</p>
                    <p className="text-xs text-muted">
                      {item.staffName} · {formatTime(item.startAt, zone)}–{formatTime(item.endAt, zone)} ({item.durationMinutes} min)
                    </p>
                  </div>
                  <p>{formatMoney(item.price)}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-right font-semibold">
              Total {formatMoney(appointment.totalPrice)}
              {appointment.comboId && <span className="ml-1 text-xs font-normal text-muted">(combo price)</span>}
            </p>
          </div>

          {appointment.notes && (
            <div>
              <p className="text-muted">Notes</p>
              <p className="whitespace-pre-wrap">{appointment.notes}</p>
            </div>
          )}

          <div>
            <p className="mb-1 text-muted">History</p>
            <ul className="space-y-1 text-xs text-muted">
              {appointment.statusHistory.map((change, i) => (
                <li key={i}>
                  {formatDateTime(change.at, zone)} · {STATUS_LABEL[change.to]}
                  {change.reason && ` — “${change.reason}”`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => changeStatus('CANCELLED', { reason: reason.trim() || undefined })}
        loading={setStatus.isPending}
        danger
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        message={
          <>
            <p className="mb-3">The time slot becomes free again. This can’t be undone.</p>
            <Textarea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </>
        }
      />
    </>
  );
}
