import { crudController } from '../crud.controller.js';
import { createBranch, getBranch, listBranches, setBranchStatus, updateBranch } from './branches.service.js';

export const { list, getOne, create, update, setStatus } = crudController(
  { one: 'branch', many: 'branches' },
  { list: listBranches, getOne: getBranch, create: createBranch, update: updateBranch, setStatus: setBranchStatus }
);
