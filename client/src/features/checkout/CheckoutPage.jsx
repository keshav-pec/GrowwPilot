import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useAppointment } from '../../api/appointments';
import { useOpenDraft } from '../../api/invoices';
import { formatDateTime } from '../../lib/time';
import { Badge, EmptyState, PageHeader, Spinner } from '../../components/ui';
import DraftEditor from './DraftEditor';

// Checkout for a finished appointment: opens its draft bill (made the first time), then the draft editor.
export default function CheckoutPage() {
  const { appointmentId } = useParams();
  const { activeBranch } = useAuth();
  const appointmentQuery = useAppointment(appointmentId);
  const openDraft = useOpenDraft();
  const [draft, setDraft] = useState(null);
  const [loads, setLoads] = useState(0); // goes up when the draft is reloaded, so the editor starts again from it

  const appointment = appointmentQuery.data;
  const ready = Boolean(appointment) && !appointment.invoiceId && appointment.status === 'COMPLETED';

  function load() {
    openDraft.mutate(
      { appointmentId },
      {
        onSuccess: (invoice) => {
          setDraft(invoice);
          setLoads((n) => n + 1);
        },
      }
    );
  }
  useEffect(() => {
    if (ready && !draft) load(); // safe to repeat: there is only ever one draft per appointment
  }, [ready]);

  if (appointmentQuery.isPending) return <Loading />;
  if (appointmentQuery.isError) return <EmptyState title="Appointment not found" message={appointmentQuery.error.message} />;
  if (appointment.invoiceId) return <Navigate to={`/app/invoices/${appointment.invoiceId}`} replace />; // already billed
  if (appointment.status !== 'COMPLETED') {
    return (
      <EmptyState
        title="Not ready for checkout"
        message="Only completed appointments can be checked out. Mark the service complete first."
        action={<Link to="/app/today" className="text-sm underline">Back to the day board</Link>}
      />
    );
  }
  if (openDraft.isError && !draft) return <EmptyState title="Couldn’t open the bill" message={openDraft.error.message} />;
  if (!draft) return <Loading />;
  if (draft.status !== 'DRAFT') return <Navigate to={`/app/invoices/${draft._id}`} replace />; // someone just issued it

  return (
    <>
      <PageHeader
        title="Checkout"
        subtitle={`${appointment.customerSnapshot.name} · ${formatDateTime(appointment.startAt, activeBranch.timezone)}`}
        actions={<Badge>Draft bill</Badge>}
      />
      <DraftEditor key={loads} draft={draft} onReplace={setDraft} onStale={load} />
    </>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner size={28} />
    </div>
  );
}
