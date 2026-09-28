import { Building2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';

// Owners with several branches pick one here. Users with one branch just see its name.
export default function BranchSwitcher() {
  const { user, activeBranchId, setActiveBranchId } = useAuth();
  const queryClient = useQueryClient();

  if (user.branches.length === 0) return null;

  if (user.branches.length === 1) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted">
        <Building2 size={16} /> {user.branches[0].name}
      </span>
    );
  }

  function handleChange(e) {
    setActiveBranchId(e.target.value);
    queryClient.invalidateQueries(); // reload every screen's data for the new branch
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <Building2 size={16} />
      <select
        value={activeBranchId || ''}
        onChange={handleChange}
        className="rounded-lg border border-border bg-bg px-2 py-1 text-sm text-ink outline-none focus:border-gold"
      >
        {user.branches.map((branch) => (
          <option key={branch._id} value={branch._id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
