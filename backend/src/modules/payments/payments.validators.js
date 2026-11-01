import { z } from 'zod';
import { objectIdSchema } from '../../validators/common.js';

export const createPaymentOrderSchema = z.object({
  orderId: objectIdSchema
});

const optionalString = z.string().trim().max(300).optional();

export const verifyPaymentSchema = z
  .object({
    providerOrderId: optionalString,
    providerPaymentId: optionalString,
    signature: optionalString,
    razorpay_order_id: optionalString,
    razorpay_payment_id: optionalString,
    razorpay_signature: optionalString
  })
  .superRefine((value, ctx) => {
    if (!(value.providerOrderId || value.razorpay_order_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerOrderId'], message: 'Provider order id is required' });
    }
    if (!(value.providerPaymentId || value.razorpay_payment_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerPaymentId'], message: 'Provider payment id is required' });
    }
    if (!(value.signature || value.razorpay_signature)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signature'], message: 'Payment signature is required' });
    }
  });

export const mockPaymentSchema = z.object({
  orderId: objectIdSchema,
  outcome: z.enum(['success', 'failure']).optional().default('success')
});

export const orderPaymentsParamsSchema = z.object({ orderId: objectIdSchema });

export const paymentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().max(40).optional(),
  provider: z.enum(['razorpay', 'mock', 'cod']).optional(),
  orderId: objectIdSchema.optional()
});
