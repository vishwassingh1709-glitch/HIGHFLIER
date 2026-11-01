import { z } from 'zod';
import { objectIdSchema, phoneSchema } from '../../validators/common.js';
import { ROLE_VALUES } from '../../constants/roles.js';

export const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(ROLE_VALUES).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional()
});

export const userIdParamsSchema = z.object({ id: objectIdSchema });

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: phoneSchema.optional(),
    role: z.enum(ROLE_VALUES).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const rangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  threshold: z.coerce.number().int().min(0).max(1000).optional()
});

export const auditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  actor: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export const webhookLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  provider: z.enum(['razorpay', 'mock']).optional(),
  status: z.enum(['received', 'processed', 'ignored', 'failed']).optional(),
  eventType: z.string().trim().max(120).optional()
});

export const syncLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  supplierId: objectIdSchema.optional(),
  type: z.enum(['catalogue', 'inventory', 'order_submit', 'order_status', 'tracking', 'connection_test']).optional(),
  status: z.enum(['started', 'success', 'partial', 'failed']).optional()
});
