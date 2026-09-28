import axios from 'axios';
import { BRANCH_STORAGE_KEY } from '../lib/constants';

// All requests go to /api. In development Vite forwards them to the Express server.
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send the login cookie with every request
});

// Tell the server which branch the user is working in
api.interceptors.request.use((config) => {
  const branchId = localStorage.getItem(BRANCH_STORAGE_KEY);
  if (branchId) config.headers['X-Branch-Id'] = branchId;
  return config;
});

// Turn the server's { error: { code, message, details } } into a normal Error,
// so every screen can simply show `error.message`.
api.interceptors.response.use(
  (response) => response,
  (err) => {
    const serverError = err.response?.data?.error;
    let message = serverError?.message || 'Something went wrong';
    if (!err.response) message = 'Cannot reach the server. Please check your connection.';

    const error = new Error(message);
    error.status = err.response?.status;
    error.code = serverError?.code;
    error.details = serverError?.details;
    return Promise.reject(error);
  }
);
