import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { usePayRequests } from '../../api/payroll';
import { PageHeader, Tabs } from '../../components/ui';
import PaySetupTab from './PaySetupTab';
import PayRequestsTab from './PayRequestsTab';
import ActivityTab from './ActivityTab';
import StaffPayDrawer from './StaffPayDrawer';

// Owners: "Payroll". Front desk: "Staff pay" (pay setup and requests only, see PAYROLL_PLAN.md)
export default function PayrollPage() {
  const { user, activeBranch } = useAuth();
  const isOwner = user.role === 'OWNER';
  const waiting = usePayRequests('pending').data?.length ?? 0;

  const tabs = [
    { value: 'setup', label: 'Pay setup' },
    { value: 'requests', label: waiting > 0 ? `Requests (${waiting})` : 'Requests' },
    ...(isOwner ? [{ value: 'activity', label: 'Activity log' }] : []),
  ];

  // The open tab and the open person live in the URL (?tab=requests&staff=<id>), so links from the bell work
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabs.some((t) => t.value === searchParams.get('tab')) ? searchParams.get('tab') : 'setup';
  const staffId = searchParams.get('staff');

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

      {tab === 'setup' && <PaySetupTab onOpenStaff={(id) => update({ staff: id })} />}
      {tab === 'requests' && <PayRequestsTab />}
      {tab === 'activity' && <ActivityTab />}

      {staffId && <StaffPayDrawer staffId={staffId} onClose={() => update({ staff: null })} />}
    </>
  );
}
