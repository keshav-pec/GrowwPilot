import {
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  LayoutDashboard,
  Package,
  Scissors,
  Target,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import Shell from './Shell';
import BranchSwitcher from './BranchSwitcher';
import ChatAssistant from '../components/ChatAssistant';
import NotificationBell from '../components/NotificationBell';
import { useAuth } from '../auth/AuthContext';
import { hasAddon } from '../lib/constants';

// Sidebar menu. `roles` says who sees each item; `addon` hides it unless the salon has that add-on.
const APP_NAV = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['OWNER'] },
  { to: '/app/today', label: 'Day board', icon: CalendarClock, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/appointments', label: 'Appointments', icon: CalendarDays, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/customers', label: 'Customers', icon: Users, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/leads', label: 'Leads', icon: Target, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/inventory', label: 'Inventory', icon: Package, roles: ['OWNER', 'FRONT_DESK', 'INVENTORY'], addon: 'inventory' },
  { to: '/app/analytics', label: 'Analytics', icon: ChartColumn, roles: ['OWNER'] },
  { to: '/app/team', label: 'Team', icon: UserCog, roles: ['OWNER'] },
  { to: '/app/branches', label: 'Branches', icon: Building2, roles: ['OWNER'] },
  { to: '/app/catalog', label: 'Services & combos', icon: Scissors, roles: ['OWNER'] },
  // Same screen: owners get all of payroll, the front desk only pay setup and requests
  { to: '/app/payroll', label: 'Payroll', icon: Wallet, roles: ['OWNER'] },
  { to: '/app/payroll', label: 'Staff pay', icon: Wallet, roles: ['FRONT_DESK'] },
];

export default function AppLayout() {
  const { user } = useAuth();
  const navItems = APP_NAV.filter((item) => item.roles.includes(user.role) && (!item.addon || hasAddon(user, item.addon)));

  return (
    <>
      <Shell
        navItems={navItems}
        topBarRight={
          <div className="flex items-center gap-3">
            <BranchSwitcher />
            <NotificationBell />
          </div>
        }
      />
      {/* Help assistant (it stays open while you move between pages) */}
      <ChatAssistant />
    </>
  );
}
