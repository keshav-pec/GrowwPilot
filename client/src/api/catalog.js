import { useResourceList, useSaveResource, useSetResourceStatus } from './resource';

// Services. Combos show service names, so they are refreshed too.
export const useServices = () => useResourceList(['services'], '/services', 'services');
export const useSaveService = () => useSaveResource('/services', [['services'], ['combos']]);
export const useSetServiceStatus = () => useSetResourceStatus('/services', [['services'], ['combos']]);

// Combos
export const useCombos = () => useResourceList(['combos'], '/combos', 'combos');
export const useSaveCombo = () => useSaveResource('/combos', [['combos']]);
export const useSetComboStatus = () => useSetResourceStatus('/combos', [['combos']]);
