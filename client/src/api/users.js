import { useMutation } from '@tanstack/react-query';
import { api } from './client';
import { useResourceList, useSaveResource, useSetResourceStatus } from './resource';

// Front desk accounts and branch owners
export const useUsers = () => useResourceList(['users'], '/users', 'users');
export const useSaveUser = () => useSaveResource('/users', [['users']]);
export const useSetUserStatus = () => useSetResourceStatus('/users', [['users']]);

export function useResetPassword() {
  return useMutation({
    mutationFn: (id) => api.post(`/users/${id}/reset-password`).then((res) => res.data),
  });
}
