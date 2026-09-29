import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { useAuth } from '../../auth/AuthContext';
import { useAppointment } from '../../api/appointments';
import { todayIn } from '../../lib/time';
import { EmptyState, PageHeader, Spinner } from '../../components/ui';
import BookingForm from './BookingForm';

// Turns a saved appointment back into the booking form's starting values
function formValuesFrom(appointment, zone) {
  const [first] = appointment.items;
  const start = DateTime.fromISO(appointment.startAt, { zone });
  return {
    customer: { _id: appointment.customerId, ...appointment.customerSnapshot },
    mode: appointment.comboId ? 'combo' : 'services',
    comboId: appointment.comboId ?? '',
    serviceIds: appointment.items.map((i) => i.serviceId),
    defaultStaffId: first.staffId,
    // Keep each item's stylist (if different) and the duration it was booked with
    overrides: Object.fromEntries(
      appointment.items.map((i) => [i.serviceId, { staffId: i.staffId !== first.staffId ? i.staffId : undefined, durationMinutes: i.durationMinutes }])
    ),
    date: start.toISODate(),
    startTime: start.toFormat('HH:mm'),
    notes: appointment.notes ?? '',
  };
}

// /app/appointments/new (optionally ?date=2026-09-28) and /app/appointments/:id/edit
export default function BookingPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { activeBranch } = useAuth();
  const appointmentQuery = useAppointment(id);

  if (id) {
    if (appointmentQuery.isPending) {
      return (
        <div className="flex justify-center py-12">
          <Spinner size={28} />
        </div>
      );
    }
    if (appointmentQuery.isError || appointmentQuery.data.status !== 'BOOKED') {
      return (
        <EmptyState
          title="This appointment can’t be edited"
          message={appointmentQuery.error?.message ?? 'Only booked appointments can be changed.'}
          action={<Link to="/app/today" className="text-sm underline">Back to the day board</Link>}
        />
      );
    }
  }

  const initial = id ? formValuesFrom(appointmentQuery.data, activeBranch.timezone) : { date: searchParams.get('date') || todayIn(activeBranch.timezone) };

  return (
    <>
      <PageHeader title={id ? 'Edit appointment' : 'New booking'} subtitle={activeBranch.name} />
      <BookingForm key={id ?? 'new'} initial={initial} appointmentId={id} />
    </>
  );
}
