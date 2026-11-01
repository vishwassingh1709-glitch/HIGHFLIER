import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { idParamSchema } from '../../validators/common.js';
import * as controller from './suppliers.controller.js';
import {
  createSupplierSchema,
  credentialSchema,
  listSuppliersQuerySchema,
  staleScanSchema,
  supplierLogsQuerySchema,
  syncCatalogueSchema,
  syncInventorySchema,
  updateMarkupSchema,
  updateSupplierSchema
} from './suppliers.validators.js';

const credentialsBodySchema = z.object({ credentials: credentialSchema });

export const adminSuppliersRouter = Router();

adminSuppliersRouter.use(requireAdmin);

adminSuppliersRouter.get('/', validate(listSuppliersQuerySchema, 'query'), controller.listSuppliers);
adminSuppliersRouter.post('/', validate(createSupplierSchema), controller.createSupplier);

adminSuppliersRouter.get('/:id', validate(idParamSchema, 'params'), controller.getSupplier);
adminSuppliersRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateSupplierSchema),
  controller.updateSupplier
);
adminSuppliersRouter.delete('/:id', validate(idParamSchema, 'params'), controller.deactivateSupplier);

adminSuppliersRouter.put(
  '/:id/credentials',
  validate(idParamSchema, 'params'),
  validate(credentialsBodySchema),
  controller.setCredentials
);
adminSuppliersRouter.delete('/:id/credentials', validate(idParamSchema, 'params'), controller.removeCredentials);

adminSuppliersRouter.post('/:id/test-connection', validate(idParamSchema, 'params'), controller.testConnection);
adminSuppliersRouter.get(
  '/:id/capabilities',
  validate(idParamSchema, 'params'),
  controller.getCapabilities
);
adminSuppliersRouter.get(
  '/:id/logs',
  validate(idParamSchema, 'params'),
  validate(supplierLogsQuerySchema, 'query'),
  controller.listLogs
);
adminSuppliersRouter.put(
  '/:id/markup',
  validate(idParamSchema, 'params'),
  validate(updateMarkupSchema),
  controller.updateMarkup
);

adminSuppliersRouter.post(
  '/:id/sync/catalogue',
  validate(idParamSchema, 'params'),
  validate(syncCatalogueSchema),
  controller.triggerCatalogueSync
);
adminSuppliersRouter.post(
  '/:id/sync/inventory',
  validate(idParamSchema, 'params'),
  validate(syncInventorySchema),
  controller.triggerInventorySync
);
adminSuppliersRouter.post(
  '/:id/sync/stale-scan',
  validate(idParamSchema, 'params'),
  validate(staleScanSchema),
  controller.triggerStaleScan
);
