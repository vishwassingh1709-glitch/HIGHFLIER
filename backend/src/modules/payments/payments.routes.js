import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { paymentRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './payments.controller.js';
import {
  createPaymentOrderSchema,
  mockPaymentSchema,
  orderPaymentsParamsSchema,
  paymentsQuerySchema,
  verifyPaymentSchema
} from './payments.validators.js';

export const paymentsRouter = Router();

// Signature-verified webhook. The raw body is captured in app.js before JSON parsing.
paymentsRouter.post('/webhook', controller.webhook);

paymentsRouter.use(authenticate);

paymentsRouter.get('/config', controller.getPaymentConfig);
paymentsRouter.post(
  '/orders/:orderId',
  paymentRateLimiter,
  validate(orderPaymentsParamsSchema, 'params'),
  controller.createPaymentOrder
);
paymentsRouter.post('/verify', paymentRateLimiter, validate(verifyPaymentSchema), controller.verifyPayment);
paymentsRouter.post('/mock/pay', paymentRateLimiter, validate(mockPaymentSchema), controller.mockPay);
paymentsRouter.get(
  '/order/:orderId',
  validate(orderPaymentsParamsSchema, 'params'),
  controller.getOrderPayments
);

export const adminPaymentsRouter = Router();

adminPaymentsRouter.use(requireAdmin);
adminPaymentsRouter.get('/', validate(paymentsQuerySchema, 'query'), controller.listPaymentsAdmin);
