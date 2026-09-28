import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './auth/AuthContext';
import { router } from './routes/router';
import './index.css';

// React Query keeps server data cached and refetches it when the tab regains focus
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1, // try a failed request once more before showing an error
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
