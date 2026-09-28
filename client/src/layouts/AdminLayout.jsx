import { Store } from 'lucide-react';
import Shell from './Shell';

const ADMIN_NAV = [{ to: '/admin/salons', label: 'Salons', icon: Store }];

export default function AdminLayout() {
  return <Shell navItems={ADMIN_NAV} />;
}
