import { z } from 'zod';
import { objectIdSchema } from '../../validators/common.js';
import { SUPPLIER_ORDER_STATUS_VALUES } from '../../constants/supplier.js';

export const supplierOrderIdSchema = z.object({ id: objectIdSchema });

export const supplierOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(SUPPLIER_ORDER_STATUS_VALUES).optional(),
  supplierId: objectIdSchema.optional(),
  orderId: objectIdSchema.optional(),
  q: z.string().trim().max(100).optional(),
  needsAttention: z.enum(['true', 'false']).optional()
});

export const supplierOrderCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Please provide a reason').max(500)
});
