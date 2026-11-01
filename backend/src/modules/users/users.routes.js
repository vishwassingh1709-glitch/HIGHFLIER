import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './users.controller.js';
import {
  addressIdParamSchema,
  changePasswordSchema,
  createAddressSchema,
  updateAddressSchema,
  updateProfileSchema
} from './users.validators.js';

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get('/me', controller.getProfile);
usersRouter.patch('/me', writeRateLimiter, validate(updateProfileSchema), controller.updateProfile);
usersRouter.patch(
  '/me/password',
  writeRateLimiter,
  validate(changePasswordSchema),
  controller.changePassword
);

usersRouter.get('/me/addresses', controller.listAddresses);
usersRouter.post('/me/addresses', writeRateLimiter, validate(createAddressSchema), controller.addAddress);
usersRouter.patch(
  '/me/addresses/:addressId',
  writeRateLimiter,
  validate(addressIdParamSchema, 'params'),
  validate(updateAddressSchema),
  controller.updateAddress
);
usersRouter.delete(
  '/me/addresses/:addressId',
  writeRateLimiter,
  validate(addressIdParamSchema, 'params'),
  controller.deleteAddress
);
usersRouter.patch(
  '/me/addresses/:addressId/default',
  writeRateLimiter,
  validate(addressIdParamSchema, 'params'),
  controller.setDefaultAddress
);
