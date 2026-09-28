import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast, { Toaster } from 'react-hot-toast';
import { AuthProvider } from './auth/AuthContext';
import { router } from './routes/router';
import './index.css';

// If any request comes back 401 while someone is logged in (session expired, account or
// salon deactivated), log them out. ProtectedRoute then sends them to the login page.
function handleAuthError(error) {
  if (error.status === 401 && queryClient.getQueryData(['me'])) {
    queryClient.setQueryData(['me'], null);
    toast.error(error.message);
  }
}

// React Query keeps server data cached and refetches it when the tab regains focus
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      // Retry a failed request once, but never retry "not logged in" or "not allowed"
      retry: (failureCount, error) => failureCount < 1 && ![401, 403, 404].includes(error.status),
      staleTime: 30_000, // data counts as fresh for 30 seconds
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
