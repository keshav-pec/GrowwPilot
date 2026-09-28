import { Badge } from '../../components/ui';

export default function SalonStatusBadge({ status }) {
  return status === 'active' ? <Badge tone="brown">Active</Badge> : <Badge tone="danger">Inactive</Badge>;
}
