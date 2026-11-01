import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '../../validators/common.js';

export const inventoryQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  supplierId: objectIdSchema.optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  threshold: z.coerce.number().int().min(0).max(1000).default(5)
});

export const inventoryTransactionsQuerySchema = paginationQuerySchema.extend({
  productId: objectIdSchema.optional(),
  sku: z.string().trim().max(120).optional(),
  type: z
    .enum(['import', 'sync', 'reservation', 'release', 'commit', 'admin_adjustment', 'return', 'restock'])
    .optional()
});

export const variantParamSchema = z.object({
  productId: objectIdSchema,
  sku: z.string().trim().min(1).max(120)
});

export const adjustStockSchema = z
  .object({
    stock: z.coerce.number().int().min(0).optional(),
    adjustment: z.coerce.number().int().optional(),
    note: z.string().trim().max(500).optional().default('')
  })
  .refine(
    (value) => (value.stock !== undefined) !== (value.adjustment !== undefined),
    'Provide exactly one of stock or adjustment'
  );
