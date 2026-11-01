import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './inventory.controller.js';
import {
  adjustStockSchema,
  inventoryQuerySchema,
  inventoryTransactionsQuerySchema,
  variantParamSchema
} from './inventory.validators.js';

export const adminInventoryRouter = Router();
adminInventoryRouter.use(requireAdmin);

adminInventoryRouter.get('/', validate(inventoryQuerySchema, 'query'), controller.listInventory);
adminInventoryRouter.get(
  '/transactions',
  validate(inventoryTransactionsQuerySchema, 'query'),
  controller.listTransactions
);
adminInventoryRouter.patch(
  '/:productId/variants/:sku',
  validate(variantParamSchema, 'params'),
  validate(adjustStockSchema),
  controller.adjustStock
);
