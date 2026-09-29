import { Badge } from './ui';
import { LEAD_STATUS_LABEL } from '../lib/leads';

const TONES = { NEW: 'gold', CONTACTED: 'yellow', INTERESTED: 'orange', APPOINTMENT_BOOKED: 'brown', LOST: 'neutral' };

export default function LeadStatusBadge({ status }) {
  return <Badge tone={TONES[status]}>{LEAD_STATUS_LABEL[status]}</Badge>;
}
