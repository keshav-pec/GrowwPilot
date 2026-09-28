import { Badge } from './ui';

const TONES = { active: 'brown', inactive: 'orange', disabled: 'orange', archived: 'neutral' };

// Badge for simple record statuses: active / inactive / disabled / archived
export default function StatusBadge({ status }) {
  return <Badge tone={TONES[status] || 'neutral'}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}
