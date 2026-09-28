import {
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  LayoutDashboard,
  Scissors,
  Target,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import Shell from './Shell';
import BranchSwitcher from './BranchSwitcher';
import { useAuth } from '../auth/AuthContext';

// Sidebar menu. `roles` says who sees each item.
const APP_NAV = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['OWNER'] },
  { to: '/app/today', label: 'Day board', icon: CalendarClock, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/appointments', label: 'Appointments', icon: CalendarDays, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/customers', label: 'Customers', icon: Users, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/leads', label: 'Leads', icon: Target, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/analytics', label: 'Analytics', icon: ChartColumn, roles: ['OWNER'] },
  { to: '/app/team', label: 'Team', icon: UserCog, roles: ['OWNER'] },
  { to: '/app/branches', label: 'Branches', icon: Building2, roles: ['OWNER'] },
  { to: '/app/catalog', label: 'Services & combos', icon: Scissors, roles: ['OWNER'] },
  { to: '/app/settings/salary', label: 'Salary', icon: Wallet, roles: ['OWNER'] },
];

export default function AppLayout() {
  const { user } = useAuth();
  const navItems = APP_NAV.filter((item) => item.roles.includes(user.role));

  return <Shell navItems={navItems} topBarRight={<BranchSwitcher />} />;
}
