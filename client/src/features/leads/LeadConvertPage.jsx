import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useLead } from '../../api/leads';
import { OPEN_LEAD_STATUSES } from '../../lib/leads';
import { todayIn } from '../../lib/time';
import { EmptyState, PageHeader, Spinner } from '../../components/ui';
import BookingForm from '../appointments/BookingForm';

// /app/leads/:id/convert: the normal booking form, pre-filled with the lead's service.
// Confirming books the appointment, links or creates the customer, and closes the lead, all at once.
export default function LeadConvertPage() {
  const { id } = useParams();
  const { activeBranch } = useAuth();
  const leadQuery = useLead(id);

  if (leadQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }

  const lead = leadQuery.data?.lead;
  if (leadQuery.isError || !OPEN_LEAD_STATUSES.includes(lead.status)) {
    return (
      <EmptyState
        title="This lead can’t be converted"
        message={leadQuery.error?.message ?? 'It has already been booked or marked lost.'}
        action={<Link to="/app/leads" className="text-sm underline">Back to leads</Link>}
      />
    );
  }

  const initial = {
    date: todayIn(activeBranch.timezone),
    serviceIds: lead.interestedServiceId ? [lead.interestedServiceId._id] : [],
  };

  return (
    <>
      <PageHeader title={`Convert ${lead.name} to an appointment`} subtitle={`${lead.source} lead · ${activeBranch.name}`} />
      <BookingForm initial={initial} leadInfo={leadQuery.data} />
    </>
  );
}
