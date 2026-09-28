import { createContext, useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { BRANCH_STORAGE_KEY } from '../lib/constants';
import { Spinner } from '../components/ui';

const AuthContext = createContext(null);

// Asks the server "who is logged in?". A 401 simply means nobody is, so we return null.
async function fetchMe() {
  try {
    const res = await api.get('/auth/me');
    return res.data.user;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [storedBranchId, setStoredBranchId] = useState(() => localStorage.getItem(BRANCH_STORAGE_KEY));

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    staleTime: Infinity, // no need to keep asking; any 401 later logs the user out (see main.jsx)
  });
  const user = meQuery.data ?? null;

  // Use the saved branch if this user may still use it, otherwise their first branch
  const branches = user?.branches ?? [];
  const activeBranchId = branches.some((b) => b._id === storedBranchId) ? storedBranchId : (branches[0]?._id ?? null);

  // Keep localStorage in step, because the API client reads the branch from there
  if (activeBranchId) localStorage.setItem(BRANCH_STORAGE_KEY, activeBranchId);
  else localStorage.removeItem(BRANCH_STORAGE_KEY);

  function setActiveBranchId(branchId) {
    localStorage.setItem(BRANCH_STORAGE_KEY, branchId);
    setStoredBranchId(branchId);
  }

  async function login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    queryClient.setQueryData(['me'], res.data.user);
    return res.data.user;
  }

  async function logout() {
    await api.post('/auth/logout').catch(() => {}); // log out locally even if the server can't be reached
    queryClient.removeQueries(); // forget all cached data from this user
    queryClient.setQueryData(['me'], null);
  }

  // First page load: wait until we know whether someone is logged in
  if (meQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, activeBranchId, setActiveBranchId, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
