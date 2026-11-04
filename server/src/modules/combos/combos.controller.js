import { crudController } from '../crud.controller.js';
import { createCombo, listCombos, setComboStatus, updateCombo } from './combos.service.js';

export const { list, create, update, setStatus } = crudController(
  { one: 'combo', many: 'combos' },
  { list: listCombos, create: createCombo, update: updateCombo, setStatus: setComboStatus }
);
