import { send, useInventoryMutation } from './request';

// { key, skuId, locationId | allocationId, qty, reason, direction?, note?, reportId? }
// -> { status: 'POSTED' | 'PENDING_APPROVAL', ... }
export const useWriteOff = () => useInventoryMutation(({ key, ...values }) => send('post', '/inventory/movements/write-offs', key, values));

// Owners: undo a mistaken finish. { key, transactionId, note }
export const useCorrectFinish = () => useInventoryMutation(({ key, transactionId, note }) => send('post', `/inventory/movements/${transactionId}/correct`, key, { note }));
