import { z } from 'zod';
import { objectIdSchema } from '../../validators/common.js';

const couponFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(3, 'Coupon code must be at least 3 characters')
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, 'Coupon code may only contain letters, numbers, hyphen and underscore'),
  description: z.string().trim().max(300).optional().default(''),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.coerce.number().positive('Discount value must be greater than zero'),
  maxDiscount: z.coerce.number().min(0).optional().default(0),
  minOrderValue: z.coerce.number().min(0).optional().default(0),
  scope: z.enum(['all', 'category', 'product']).optional().default('all'),
  categories: z.array(objectIdSchema).max(50).optional().default([]),
  products: z.array(objectIdSchema).max(200).optional().default([]),
  usageLimit: z.coerce.number().int().min(0).optional().default(0),
  perUserLimit: z.coerce.number().int().min(0).optional().default(1),
  startsAt: z.coerce.date().nullable().optional().default(null),
  expiresAt: z.coerce.date().nullable().optional().default(null),
  isActive: z.boolean().optional().default(true)
};

export const createCouponSchema = z
  .object(couponFields)
  .superRefine((value, ctx) => {
    if (value.discountType === 'percent' && value.discountValue > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountValue'], message: 'Percent discount cannot exceed 100' });
    }
    if (value.scope === 'category' && value.categories.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Select at least one category' });
    }
    if (value.scope === 'product' && value.products.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['products'], message: 'Select at least one product' });
    }
    if (value.startsAt && value.expiresAt && value.startsAt >= value.expiresAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Expiry must be after the start date' });
    }
  });

export const updateCouponSchema = z.object(couponFields).partial().extend({
  code: couponFields.code.optional()
});

export const validateCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(40),
  items: z
    .array(
      z.object({
        productId: objectIdSchema,
        sku: z.string().trim().min(1).max(120),
        quantity: z.coerce.number().int().min(1).max(20)
      })
    )
    .max(50)
    .optional()
});

export const couponIdSchema = z.object({ id: objectIdSchema });
