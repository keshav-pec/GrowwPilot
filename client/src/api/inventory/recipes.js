import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// Services at the selected branch with their recipes: [{ service, salon: { current, upcoming }, branch: {...}, applies }]
export function useRecipes() {
  return useQuery({
    queryKey: ['inventory', 'recipes'],
    queryFn: () => api.get('/inventory/recipes').then((res) => res.data.services),
  });
}

// Every version of one service's recipe, newest first. scope: 'salon' | 'branch'
export function useRecipeHistory(serviceId, scope) {
  return useQuery({
    queryKey: ['inventory', 'recipe-history', serviceId, scope],
    queryFn: () => api.get('/inventory/recipes/history', { params: { serviceId, scope } }).then((res) => res.data.versions),
    enabled: Boolean(serviceId),
  });
}

// { key, serviceId, scope, effectiveFrom?, lines: [{ skuId, qty, deducts, useStoreIfNeeded }], note? }
export const useSaveRecipe = () => useInventoryMutation(({ key, ...values }) => send('post', '/inventory/recipes', key, values));

// { key, serviceId, scope }
export const useEndRecipe = () => useInventoryMutation(({ key, ...values }) => send('post', '/inventory/recipes/end', key, values));
