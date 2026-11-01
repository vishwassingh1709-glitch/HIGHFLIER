import { Router } from 'express';
import { authenticate, optionalAuth, requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './reviews.controller.js';
import {
  adminReviewsQuerySchema,
  createReviewSchema,
  moderateReviewSchema,
  myReviewsQuerySchema,
  productIdParamSchema,
  productReviewsQuerySchema,
  reviewIdParamSchema,
  updateReviewSchema
} from './reviews.validators.js';

export const reviewsRouter = Router();

reviewsRouter.get(
  '/product/:productId',
  optionalAuth,
  validate(productIdParamSchema, 'params'),
  validate(productReviewsQuerySchema, 'query'),
  controller.listProductReviews
);

reviewsRouter.get('/me', authenticate, validate(myReviewsQuerySchema, 'query'), controller.listMyReviews);
reviewsRouter.post(
  '/product/:productId',
  authenticate,
  writeRateLimiter,
  validate(productIdParamSchema, 'params'),
  validate(createReviewSchema),
  controller.createReview
);
reviewsRouter.patch(
  '/:id',
  authenticate,
  writeRateLimiter,
  validate(reviewIdParamSchema, 'params'),
  validate(updateReviewSchema),
  controller.updateReview
);
reviewsRouter.delete(
  '/:id',
  authenticate,
  writeRateLimiter,
  validate(reviewIdParamSchema, 'params'),
  controller.deleteReview
);

export const adminReviewsRouter = Router();

adminReviewsRouter.use(requireAdmin);

adminReviewsRouter.get('/', validate(adminReviewsQuerySchema, 'query'), controller.listReviewsAdmin);
adminReviewsRouter.patch(
  '/:id',
  writeRateLimiter,
  validate(reviewIdParamSchema, 'params'),
  validate(moderateReviewSchema),
  controller.moderateReviewAdmin
);
adminReviewsRouter.delete(
  '/:id',
  writeRateLimiter,
  validate(reviewIdParamSchema, 'params'),
  controller.deleteReviewAdmin
);
