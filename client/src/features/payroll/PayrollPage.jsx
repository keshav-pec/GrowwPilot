import { useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { useAuth } from '../../auth/AuthContext';
import { usePayRequests } from '../../api/payroll';
import { PageHeader, Tabs } from '../../components/ui';
import PaySetupTab from './PaySetupTab';
import PayRequestsTab from './PayRequestsTab';
import ActivityTab from './ActivityTab';
import MonthlyPayrollTab from './MonthlyPayrollTab';
import StaffPayDrawer from './StaffPayDrawer';
import { GROUPS } from './GroupSwitch';

// Owners: "Payroll". Front desk: "Staff pay" (pay setup and requests only, see PAYROLL_PLAN.md)
export default function PayrollPage() {
  const { user, activeBranch } = useAuth();
  const isOwner = user.role === 'OWNER';
  const waiting = usePayRequests('pending').data?.length ?? 0;

  const tabs = [
    ...(isOwner ? [{ value: 'month', label: 'Monthly payroll' }] : []),
    { value: 'setup', label: 'Pay setup' },
    { value: 'requests', label: waiting > 0 ? `Requests (${waiting})` : 'Requests' },
    ...(isOwner ? [{ value: 'activity', label: 'Activity log' }] : []),
  ];

  // The open tab and the open person live in the URL (?tab=requests&staff=<id>), so links from the bell work
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabs.some((t) => t.value === searchParams.get('tab')) ? searchParams.get('tab') : tabs[0].value;
  const staffId = searchParams.get('staff');
  // Owners see two sections, Staff and Front desk (?group=front-desk). The front desk only sees staff.
  const group = isOwner && GROUPS.some((g) => g.value === searchParams.get('group')) ? searchParams.get('group') : 'staff';

  // Early in a month, owners are usually paying last month's salaries, so show that one first
  const now = DateTime.now().setZone(activeBranch?.timezone);
  const defaultMonth = (now.day <= 7 ? now.minus({ months: 1 }) : now).toFormat('yyyy-MM');
  const month = /^\d{4}-\d{2}$/.test(searchParams.get('month') ?? '') ? searchParams.get('month') : defaultMonth;

  function update(changes) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    setSearchParams(next);
  }

  return (
    <>
      <PageHeader
        title={isOwner ? 'Payroll' : 'Staff pay'}
        subtitle={
          isOwner
            ? `How each person at ${activeBranch?.name} is paid. Every change is logged.`
            : `How each person at ${activeBranch?.name} is paid. Pay changes need an owner’s approval.`
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={(value) => update({ tab: value })} />

      {tab === 'month' && (
        <MonthlyPayrollTab
          month={month}
          onMonthChange={(value) => update({ month: value })}
          group={group}
          onGroupChange={(value) => update({ group: value })}
          onOpenPaySetup={(id) => update({ tab: 'setup', staff: id })}
        />
      )}
      {tab === 'setup' && <PaySetupTab group={group} onGroupChange={(value) => update({ group: value })} onOpenStaff={(id) => update({ staff: id })} />}
      {tab === 'requests' && <PayRequestsTab />}
      {tab === 'activity' && <ActivityTab />}

      {staffId && <StaffPayDrawer staffId={staffId} onClose={() => update({ staff: null })} />}
    </>
  );
}
