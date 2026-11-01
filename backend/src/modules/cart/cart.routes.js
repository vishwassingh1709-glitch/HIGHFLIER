import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './cart.controller.js';
import { addCartItemSchema, cartItemParamsSchema, updateCartItemSchema } from './cart.validators.js';

export const cartRouter = Router();

cartRouter.use(authenticate);

cartRouter.get('/', controller.getCart);
cartRouter.post('/', writeRateLimiter, validate(addCartItemSchema), controller.addItem);
cartRouter.patch(
  '/items/:productId/:sku',
  writeRateLimiter,
  validate(cartItemParamsSchema, 'params'),
  validate(updateCartItemSchema),
  controller.updateItem
);
cartRouter.delete('/items/:productId/:sku', validate(cartItemParamsSchema, 'params'), controller.removeItem);
cartRouter.delete('/', controller.clearCart);
