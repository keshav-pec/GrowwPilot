import { Badge } from './ui';
import { STATUS_LABEL } from '../lib/appointments';
import { LEAD_STATUS_LABEL } from '../lib/leads';

const badgeFor = (tones, labelOf) =>
  function StatusBadge({ status }) {
    return <Badge tone={tones[status] || 'neutral'}>{labelOf(status)}</Badge>;
  };

// Simple record statuses: active / inactive / disabled / archived
export default badgeFor({ active: 'brown', inactive: 'orange', disabled: 'orange', archived: 'neutral' }, (status) => status.charAt(0).toUpperCase() + status.slice(1));

export const AppointmentStatusBadge = badgeFor({ BOOKED: 'gold', ARRIVED: 'yellow', IN_SERVICE: 'orange', COMPLETED: 'brown', CANCELLED: 'neutral' }, (status) => STATUS_LABEL[status]);

export const LeadStatusBadge = badgeFor({ NEW: 'gold', CONTACTED: 'yellow', INTERESTED: 'orange', APPOINTMENT_BOOKED: 'brown', LOST: 'neutral' }, (status) => LEAD_STATUS_LABEL[status]);
