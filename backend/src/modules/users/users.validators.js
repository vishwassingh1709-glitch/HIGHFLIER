import { z } from 'zod';
import { addressSchema, addressUpdateSchema, objectIdSchema, passwordSchema, phoneSchema } from '../../validators/common.js';

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: phoneSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: passwordSchema
});

export const createAddressSchema = addressSchema;
export const updateAddressSchema = addressUpdateSchema;
export const addressIdParamSchema = z.object({ addressId: objectIdSchema });
