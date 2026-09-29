import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAppointments, useSetAppointmentStatus } from '../../api/appointments';
import { useStaff } from '../../api/staff';
import { NEXT_STEP, STATUS_LABEL, getAlert } from '../../lib/appointments';
import { addDays, formatDay, formatTime, todayIn } from '../../lib/time';
import { Button, EmptyState, PageHeader, Spinner } from '../../components/ui';
import AppointmentDrawer from './AppointmentDrawer';

const PX_PER_MINUTE = 1.6; // 15 minutes = 24px tall

// Block colours by status
const BLOCK_STYLE = {
  BOOKED: 'bg-bg border-gold',
  ARRIVED: 'bg-yellow-soft border-yellow',
  IN_SERVICE: 'bg-gold/15 border-gold-dark',
  COMPLETED: 'bg-brown/10 border-brown',
};

// The receptionist's home screen: one column per stylist, time running down the page.
// It answers "who is free right now?" at a glance.
export default function DayBoardPage() {
  const navigate = useNavigate();
  const { activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get('date') || todayIn(zone);
  const isToday = date === todayIn(zone);

  const appointmentsQuery = useAppointments({ date });
  const staffQuery = useStaff();
  const setStatus = useSetAppointmentStatus();
  const [selectedId, setSelectedId] = useState(null);

  // Opening hours of this branch on this day, in the branch's timezone
  const opens = DateTime.fromISO(`${date}T${activeBranch.openTime}`, { zone });
  const closes = DateTime.fromISO(`${date}T${activeBranch.closeTime}`, { zone });
  const dayMinutes = closes.diff(opens, 'minutes').minutes;
  const minutesFromOpen = (iso) => DateTime.fromISO(iso).diff(opens, 'minutes').minutes;

  const hours = [];
  for (let t = opens; t < closes; t = t.plus({ hours: 1 })) hours.push(t);

  const appointments = (appointmentsQuery.data ?? []).filter((a) => a.status !== 'CANCELLED');
  const selected = appointments.find((a) => a._id === selectedId);

  // Columns: active stylists, plus anyone who has a booking today (e.g. deactivated since)
  const columns = (staffQuery.data ?? []).filter(
    (s) => s.status === 'active' || appointments.some((a) => a.items.some((i) => i.staffId === s._id))
  );

  function nextStep(e, appointment) {
    e.stopPropagation(); // don't also open the drawer
    const next = NEXT_STEP[appointment.status];
    setStatus.mutate(
      { _id: appointment._id, status: next.status },
      {
        onSuccess: () => toast.success(`${appointment.customerSnapshot.name}: ${STATUS_LABEL[next.status].toLowerCase()}`),
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const isLoading = appointmentsQuery.isPending || staffQuery.isPending;

  return (
    <>
      <PageHeader
        title="Day board"
        subtitle={`${activeBranch.name} · ${formatDay(date)}${isToday ? ' (today)' : ''}`}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => setSearchParams({ date: addDays(date, -1) })} aria-label="Previous day">
                <ChevronLeft size={16} />
              </Button>
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setSearchParams({ date: e.target.value })}
                className="rounded-lg border border-border px-2 py-1.5 text-sm"
              />
              <Button variant="secondary" size="sm" onClick={() => setSearchParams({ date: addDays(date, 1) })} aria-label="Next day">
                <ChevronRight size={16} />
              </Button>
              {!isToday && (
                <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                  Today
                </Button>
              )}
            </div>
            <Button onClick={() => navigate(`/app/appointments/new?date=${date}`)}>
              <CalendarPlus size={16} /> New booking
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={28} />
        </div>
      ) : columns.length === 0 ? (
        <EmptyState
          title="No stylists at this branch yet"
          message="The owner can add stylists under Team."
          action={<Link to="/app/team" className="text-sm underline">Go to Team</Link>}
        />
      ) : (
        // overflow-x-auto: on a phone the columns scroll sideways
        <div className="overflow-x-auto rounded-xl border border-border">
          <div className="flex min-w-full">
            {/* Time labels on the left */}
            <div className="w-16 shrink-0 border-r border-border bg-surface">
              <div className="h-10 border-b border-border" />
              <div className="relative" style={{ height: dayMinutes * PX_PER_MINUTE }}>
                {hours.map((h) => (
                  <span key={h.toMillis()} className="absolute right-2 -translate-y-2 text-xs text-muted" style={{ top: h.diff(opens, 'minutes').minutes * PX_PER_MINUTE }}>
                    {h.toFormat('h a')}
                  </span>
                ))}
              </div>
            </div>

            {/* One column per stylist */}
            {columns.map((staff) => {
              const blocks = appointments.flatMap((a) => a.items.filter((i) => i.staffId === staff._id).map((item) => ({ appointment: a, item })));
              return (
                <div key={staff._id} className="min-w-44 flex-1 border-r border-border last:border-r-0 sm:min-w-52">
                  <div className="sticky top-0 flex h-10 items-center border-b border-border bg-surface px-3 text-sm font-medium">
                    {staff.name}
                    {staff.status !== 'active' && <span className="ml-1 text-xs text-orange">(inactive)</span>}
                  </div>
                  <div className="relative" style={{ height: dayMinutes * PX_PER_MINUTE }}>
                    {/* Hour lines */}
                    {hours.map((h) => (
                      <div key={h.toMillis()} className="absolute inset-x-0 border-t border-border/70" style={{ top: h.diff(opens, 'minutes').minutes * PX_PER_MINUTE }} />
                    ))}

                    {/* "Now" line */}
                    {isToday && DateTime.now() > opens && DateTime.now() < closes && (
                      <div className="absolute inset-x-0 z-10 border-t-2 border-orange" style={{ top: DateTime.now().diff(opens, 'minutes').minutes * PX_PER_MINUTE }} />
                    )}

                    {blocks.map(({ appointment, item }) => {
                      const alert = getAlert(appointment);
                      const next = NEXT_STEP[appointment.status];
                      return (
                        <button
                          key={item._id}
                          type="button"
                          onClick={() => setSelectedId(appointment._id)}
                          className={`absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-2 py-1 text-left text-xs shadow-sm hover:shadow ${BLOCK_STYLE[appointment.status]} ${alert ? 'ring-2 ring-orange' : ''}`}
                          style={{ top: minutesFromOpen(item.startAt) * PX_PER_MINUTE, height: Math.max(item.durationMinutes * PX_PER_MINUTE, 24) }}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="truncate font-semibold text-ink">{appointment.customerSnapshot.name}</p>
                            {next && (
                              <span
                                role="button"
                                onClick={(e) => nextStep(e, appointment)}
                                className="shrink-0 rounded bg-gold px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-gold-dark"
                              >
                                {next.label}
                              </span>
                            )}
                            {appointment.status === 'COMPLETED' && (
                              <span
                                role="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(appointment.invoiceId ? `/app/invoices/${appointment.invoiceId}` : `/app/checkout/${appointment._id}`);
                                }}
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${appointment.invoiceId ? 'border border-brown text-brown' : 'bg-brown text-white'}`}
                              >
                                {appointment.invoiceId ? 'Paid ✓' : 'Checkout'}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-muted">
                            {item.serviceName} · {formatTime(item.startAt, zone)}–{formatTime(item.endAt, zone)}
                          </p>
                          {alert && <p className="font-medium text-orange">{alert}</p>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && <AppointmentDrawer appointment={selected} onClose={() => setSelectedId(null)} />}
    </>
  );
}
