import { z } from 'zod';
import { addressSchema, objectIdSchema } from '../../validators/common.js';
import { PAYMENT_METHOD_VALUES } from '../../constants/payment.js';
import { ORDER_STATUS_VALUES } from '../../constants/orderStatus.js';

const checkoutItemSchema = z.object({
  productId: objectIdSchema,
  sku: z.string().trim().min(1, 'Variant SKU is required').max(120),
  quantity: z.coerce.number().int().min(1).max(20)
});

export const checkoutSchema = z.object({
  addressId: objectIdSchema.optional(),
  shippingAddress: addressSchema.optional(),
  paymentMethod: z.enum(PAYMENT_METHOD_VALUES),
  couponCode: z.string().trim().max(40).optional(),
  items: z.array(checkoutItemSchema).max(50).optional(),
  customerNote: z.string().trim().max(1000).optional().default('')
});

export const orderIdParamsSchema = z.object({ id: z.string().trim().min(1).max(60) });

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Please provide a cancellation reason').max(500)
});

export const returnRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Please provide a return reason').max(500),
  note: z.string().trim().max(1000).optional().default('')
});

export const myOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(ORDER_STATUS_VALUES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export const adminOrdersQuerySchema = myOrdersQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  userId: objectIdSchema.optional(),
  paymentStatus: z.string().trim().max(40).optional(),
  fulfilmentIssue: z.enum(['true', 'false']).optional(),
  supplierId: objectIdSchema.optional()
});

export const adminStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
  note: z.string().trim().max(500).optional().default('')
});

export const trackingSchema = z.object({
  courier: z.string().trim().max(120).optional().default(''),
  trackingNumber: z.string().trim().max(120).optional().default(''),
  trackingUrl: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .default('')
    .refine((value) => !value || /^https?:\/\/.+/i.test(value), 'Tracking URL must start with http:// or https://'),
  isMock: z.boolean().optional().default(false),
  note: z.string().trim().max(500).optional().default('')
});

export const adminRefundSchema = z.object({
  amount: z.coerce.number().positive('Refund amount must be positive').optional(),
  reason: z.string().trim().min(3).max(500),
  restock: z.boolean().optional().default(false)
});

export const adminReturnDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional().default('')
});

export const adminNoteSchema = z.object({
  adminNote: z.string().trim().max(1000).optional().default('')
});
