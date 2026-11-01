import { z } from 'zod';
import { objectIdSchema } from '../../validators/common.js';

export const addCartItemSchema = z.object({
  productId: objectIdSchema,
  sku: z.string().trim().min(1, 'Variant SKU is required').max(120),
  quantity: z.coerce.number().int().min(1).max(20).default(1)
});

export const updateCartItemSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(20)
});

export const cartItemParamsSchema = z.object({
  productId: objectIdSchema,
  sku: z.string().trim().min(1).max(120)
});
