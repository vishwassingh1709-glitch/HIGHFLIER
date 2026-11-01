import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './supplierOrders.controller.js';
import {
  supplierOrderCancelSchema,
  supplierOrderIdSchema,
  supplierOrdersQuerySchema
} from './supplierOrders.validators.js';

export const adminSupplierOrdersRouter = Router();

adminSupplierOrdersRouter.use(requireAdmin);

adminSupplierOrdersRouter.get('/', validate(supplierOrdersQuerySchema, 'query'), controller.list);
adminSupplierOrdersRouter.get('/stats', controller.stats);
adminSupplierOrdersRouter.post('/retry-due', writeRateLimiter, controller.retryAllDue);
adminSupplierOrdersRouter.get('/:id', validate(supplierOrderIdSchema, 'params'), controller.get);
adminSupplierOrdersRouter.post('/:id/retry', writeRateLimiter, validate(supplierOrderIdSchema, 'params'), controller.retry);
adminSupplierOrdersRouter.post(
  '/:id/sync',
  writeRateLimiter,
  validate(supplierOrderIdSchema, 'params'),
  controller.syncStatus
);
adminSupplierOrdersRouter.post(
  '/:id/cancel',
  writeRateLimiter,
  validate(supplierOrderIdSchema, 'params'),
  validate(supplierOrderCancelSchema),
  controller.cancel
);
