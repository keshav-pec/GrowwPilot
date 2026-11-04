import { crudController } from '../crud.controller.js';
import { createService, listServices, setServiceStatus, updateService } from './services.service.js';

export const { list, create, update, setStatus } = crudController(
  { one: 'service', many: 'services' },
  { list: listServices, create: createService, update: updateService, setStatus: setServiceStatus }
);
