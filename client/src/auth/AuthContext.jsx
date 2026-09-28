import { createContext, useContext, useState } from 'react';
import { BRANCH_STORAGE_KEY } from '../lib/constants';

// TEMPORARY (Phase 2): fake users so we can see each role's layout.
// Phase 4 replaces this with real login using GET /api/auth/me.
const DEMO_USERS = {
  SUPER_ADMIN: { name: 'GrowwPilot Admin', role: 'SUPER_ADMIN', branches: [] },
  OWNER: {
    name: 'Demo Owner',
    role: 'OWNER',
    branches: [
      { _id: 'demo-andheri', name: 'Andheri' },
      { _id: 'demo-bandra', name: 'Bandra' },
    ],
  },
  FRONT_DESK: { name: 'Demo Front Desk', role: 'FRONT_DESK', branches: [{ _id: 'demo-andheri', name: 'Andheri' }] },
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => DEMO_USERS[localStorage.getItem('gp_demo_role')] || null);
  const [activeBranchId, setActiveBranchIdState] = useState(() => localStorage.getItem(BRANCH_STORAGE_KEY));

  function setActiveBranchId(branchId) {
    localStorage.setItem(BRANCH_STORAGE_KEY, branchId);
    setActiveBranchIdState(branchId);
  }

  function loginAs(role) {
    const demoUser = DEMO_USERS[role];
    localStorage.setItem('gp_demo_role', role);
    setUser(demoUser);
    // Start in the user's first branch
    if (demoUser.branches.length > 0) setActiveBranchId(demoUser.branches[0]._id);
    else localStorage.removeItem(BRANCH_STORAGE_KEY);
  }

  function logout() {
    localStorage.removeItem('gp_demo_role');
    localStorage.removeItem(BRANCH_STORAGE_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, activeBranchId, setActiveBranchId, loginAs, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
