import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './coupons.controller.js';
import {
  couponIdSchema,
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema
} from './coupons.validators.js';
import { z } from 'zod';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional()
});

export const couponsRouter = Router();

couponsRouter.post('/validate', authenticate, validate(validateCouponSchema), controller.validateCoupon);

export const adminCouponsRouter = Router();

adminCouponsRouter.use(requireAdmin);

adminCouponsRouter.get('/', validate(listQuerySchema, 'query'), controller.listCoupons);
adminCouponsRouter.post('/', writeRateLimiter, validate(createCouponSchema), controller.createCoupon);
adminCouponsRouter.get('/:id', validate(couponIdSchema, 'params'), controller.getCoupon);
adminCouponsRouter.patch(
  '/:id',
  writeRateLimiter,
  validate(couponIdSchema, 'params'),
  validate(updateCouponSchema),
  controller.updateCoupon
);
adminCouponsRouter.delete('/:id', validate(couponIdSchema, 'params'), controller.deactivateCoupon);
