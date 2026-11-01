import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '../../validators/common.js';

const reviewImageSchema = z.object({
  url: z.string().trim().url('Image URL is invalid'),
  publicId: z.string().trim().max(200).optional().default('')
});

export const productReviewsQuerySchema = paginationQuerySchema.extend({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sort: z.enum(['newest', 'oldest', 'highest', 'lowest']).default('newest')
});

export const createReviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rating must be between 1 and 5').max(5),
  title: z.string().trim().max(120).optional().default(''),
  comment: z.string().trim().min(3, 'Review must be at least 3 characters').max(2000),
  images: z.array(reviewImageSchema).max(4, 'At most 4 images are allowed').optional().default([])
});

export const updateReviewSchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    title: z.string().trim().max(120).optional(),
    comment: z.string().trim().min(3).max(2000).optional(),
    images: z.array(reviewImageSchema).max(4).optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const reviewIdParamSchema = z.object({ id: objectIdSchema });
export const productIdParamSchema = z.object({ productId: objectIdSchema });

export const myReviewsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'rejected']).optional()
});

export const adminReviewsQuerySchema = paginationQuerySchema.extend({
  product: objectIdSchema.optional(),
  user: objectIdSchema.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional()
});

export const moderateReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional().default('')
});
