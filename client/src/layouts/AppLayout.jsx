import {
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  Gift,
  LayoutDashboard,
  Package,
  Receipt,
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
  { to: '/app/bills', label: 'Bills', icon: Receipt, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/cash', label: 'Cash drawer', icon: Banknote, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/customers', label: 'Customers', icon: Users, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/leads', label: 'Leads', icon: Target, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['OWNER', 'FRONT_DESK'] },
  { to: '/app/inventory', label: 'Inventory', icon: Package, roles: ['OWNER', 'FRONT_DESK', 'INVENTORY'], addon: 'inventory' },
  { to: '/app/analytics', label: 'Analytics', icon: ChartColumn, roles: ['OWNER'] },
  { to: '/app/team', label: 'Team', icon: UserCog, roles: ['OWNER'] },
  { to: '/app/branches', label: 'Branches', icon: Building2, roles: ['OWNER'] },
  { to: '/app/catalog', label: 'Services & combos', icon: Scissors, roles: ['OWNER'] },
  // Birthday & Anniversary Offers: the list while switched on; owners reach the settings while it is off
  { to: '/app/occasions', label: 'Occasion offers', icon: Gift, roles: ['OWNER', 'FRONT_DESK'], occasions: true },
  { to: '/app/settings/occasions', label: 'Occasion offers', icon: Gift, roles: ['OWNER'], occasions: false },
  // Same screen: owners get all of payroll, the front desk only pay setup and requests
  { to: '/app/payroll', label: 'Payroll', icon: Wallet, roles: ['OWNER'] },
  { to: '/app/payroll', label: 'Staff pay', icon: Wallet, roles: ['FRONT_DESK'] },
];

export default function AppLayout() {
  const { user } = useAuth();
  const occasionsOn = Boolean(user.org?.occasionOffers?.enabled);
  const navItems = APP_NAV.filter(
    (item) => item.roles.includes(user.role) && (!item.addon || hasAddon(user, item.addon)) && (item.occasions === undefined || item.occasions === occasionsOn)
  );

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
