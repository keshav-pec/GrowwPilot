import { useChange } from '../request';

export { send } from '../request';

// A change that refreshes every Inventory screen (and the bell) when it works
export const useInventoryMutation = (mutationFn) => useChange(mutationFn, ['inventory', 'notifications']);
