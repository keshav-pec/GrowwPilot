import { useResourceList, useSaveResource, useSetResourceStatus } from './resource';

// ['me'] is refreshed too, so the branch switcher shows new or archived branches
const refresh = [['branches'], ['me']];

export const useBranches = () => useResourceList(['branches'], '/branches', 'branches');
export const useSaveBranch = () => useSaveResource('/branches', refresh);
export const useSetBranchStatus = () => useSetResourceStatus('/branches', refresh);
