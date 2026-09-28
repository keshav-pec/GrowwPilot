import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader, Tabs } from '../../components/ui';
import StaffTab from './StaffTab';
import LoginsTab from './LoginsTab';

export default function TeamPage() {
  const { user, activeBranchId } = useAuth();
  const branchName = user.branches.find((b) => b._id === activeBranchId)?.name;

  // Only the main owner manages other owners
  const tabs = [
    { value: 'staff', label: 'Staff' },
    { value: 'front-desk', label: 'Front desk logins' },
    ...(user.allBranches ? [{ value: 'owners', label: 'Branch owners' }] : []),
  ];

  // The open tab lives in the URL (?tab=staff), so a page refresh keeps it
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabs.some((t) => t.value === searchParams.get('tab')) ? searchParams.get('tab') : 'staff';

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={tab === 'owners' ? 'Owners who manage some of your branches' : `People at ${branchName}`}
      />
      <Tabs tabs={tabs} value={tab} onChange={(value) => setSearchParams({ tab: value })} />

      {tab === 'staff' && <StaffTab />}
      {tab === 'front-desk' && <LoginsTab role="FRONT_DESK" />}
      {tab === 'owners' && <LoginsTab role="OWNER" />}
    </>
  );
}
