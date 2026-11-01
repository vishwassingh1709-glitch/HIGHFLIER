import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './admin.controller.js';
import {
  auditLogsQuerySchema,
  rangeQuerySchema,
  syncLogsQuerySchema,
  updateUserSchema,
  userIdParamsSchema,
  usersQuerySchema,
  webhookLogsQuerySchema
} from './admin.validators.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/dashboard', controller.getDashboard);

adminRouter.get('/users', validate(usersQuerySchema, 'query'), controller.listUsers);
adminRouter.get('/users/:id', validate(userIdParamsSchema, 'params'), controller.getUser);
adminRouter.patch(
  '/users/:id',
  writeRateLimiter,
  validate(userIdParamsSchema, 'params'),
  validate(updateUserSchema),
  controller.updateUser
);
adminRouter.post(
  '/users/:id/revoke-sessions',
  writeRateLimiter,
  validate(userIdParamsSchema, 'params'),
  controller.revokeUserSessions
);

adminRouter.get('/reports/sales', validate(rangeQuerySchema, 'query'), controller.getSalesReport);
adminRouter.get('/reports/top-products', validate(rangeQuerySchema, 'query'), controller.getTopProducts);
adminRouter.get('/reports/low-stock', validate(rangeQuerySchema, 'query'), controller.getLowStock);
adminRouter.get('/reports/suppliers', controller.getSupplierPerformance);

adminRouter.get('/audit-logs', validate(auditLogsQuerySchema, 'query'), controller.listAuditLogs);
adminRouter.get('/webhook-logs', validate(webhookLogsQuerySchema, 'query'), controller.listWebhookEvents);
adminRouter.get('/sync-logs', validate(syncLogsQuerySchema, 'query'), controller.listSyncLogs);
