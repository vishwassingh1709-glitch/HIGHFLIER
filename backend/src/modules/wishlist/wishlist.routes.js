import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './wishlist.controller.js';
import { wishlistParamsSchema, wishlistProductSchema } from './wishlist.validators.js';

export const wishlistRouter = Router();

wishlistRouter.use(authenticate);

wishlistRouter.get('/', controller.getWishlist);
wishlistRouter.post('/', writeRateLimiter, validate(wishlistProductSchema), controller.addProduct);
wishlistRouter.delete('/:productId', validate(wishlistParamsSchema, 'params'), controller.removeProduct);
wishlistRouter.delete('/', controller.clearWishlist);
