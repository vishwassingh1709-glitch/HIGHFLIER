import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { paymentRateLimiter, writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './orders.controller.js';
import {
  adminNoteSchema,
  adminOrdersQuerySchema,
  adminRefundSchema,
  adminReturnDecisionSchema,
  adminStatusSchema,
  cancelOrderSchema,
  checkoutSchema,
  myOrdersQuerySchema,
  orderIdParamsSchema,
  returnRequestSchema,
  trackingSchema
} from './orders.validators.js';

export const ordersRouter = Router();

ordersRouter.post('/checkout', paymentRateLimiter, validate(checkoutSchema), controller.checkout);
ordersRouter.get('/', validate(myOrdersQuerySchema, 'query'), controller.listMyOrders);
ordersRouter.get('/:id', validate(orderIdParamsSchema, 'params'), controller.getMyOrder);
ordersRouter.post(
  '/:id/cancel',
  writeRateLimiter,
  validate(orderIdParamsSchema, 'params'),
  validate(cancelOrderSchema),
  controller.cancelMyOrder
);
ordersRouter.post(
  '/:id/return',
  writeRateLimiter,
  validate(orderIdParamsSchema, 'params'),
  validate(returnRequestSchema),
  controller.requestReturn
);

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAdmin);

adminOrdersRouter.get('/', validate(adminOrdersQuerySchema, 'query'), controller.listOrdersAdmin);
adminOrdersRouter.get('/:id', validate(orderIdParamsSchema, 'params'), controller.getOrderAdmin);
adminOrdersRouter.patch(
  '/:id/status',
  writeRateLimiter,
  validate(orderIdParamsSchema, 'params'),
  validate(adminStatusSchema),
  controller.updateStatusAdmin
);
adminOrdersRouter.patch(
  '/:id/tracking',
  writeRateLimiter,
  validate(orderIdParamsSchema, 'params'),
  validate(trackingSchema),
  controller.updateTrackingAdmin
);
adminOrdersRouter.patch(
  '/:id/note',
  writeRateLimiter,
  validate(orderIdParamsSchema, 'params'),
  validate(adminNoteSchema),
  controller.addNoteAdmin
);
adminOrdersRouter.post(
  '/:id/refund',
  paymentRateLimiter,
  validate(orderIdParamsSchema, 'params'),
  validate(adminRefundSchema),
  controller.refundAdmin
);
adminOrdersRouter.post(
  '/:id/return-decision',
  writeRateLimiter,
  validate(orderIdParamsSchema, 'params'),
  validate(adminReturnDecisionSchema),
  controller.resolveReturnAdmin
);
