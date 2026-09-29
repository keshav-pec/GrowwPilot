import { Badge } from './ui';
import { STATUS_LABEL } from '../lib/appointments';

const TONES = { BOOKED: 'gold', ARRIVED: 'yellow', IN_SERVICE: 'orange', COMPLETED: 'brown', CANCELLED: 'neutral' };

export default function AppointmentStatusBadge({ status }) {
  return <Badge tone={TONES[status]}>{STATUS_LABEL[status]}</Badge>;
}
