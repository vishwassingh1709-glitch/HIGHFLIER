import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '../../validators/common.js';

export const listProductsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(160).optional(),
  brand: z.string().trim().max(160).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  sort: z
    .enum(['newest', 'oldest', 'price_asc', 'price_desc', 'rating', 'popular', 'name_asc'])
    .default('newest')
});

export const productIdentifierParamSchema = z.object({
  identifier: z.string().trim().min(1).max(160)
});

export const adminListProductsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['draft', 'active', 'inactive', 'discontinued']).optional(),
  supplierStatus: z.enum(['available', 'unavailable', 'stale', 'discontinued']).optional(),
  supplier: objectIdSchema.optional(),
  category: z.string().trim().max(160).optional(),
  brand: z.string().trim().max(160).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'name_asc']).default('newest')
});

const productImageSchema = z.object({
  url: z.string().trim().url(),
  publicId: z.string().trim().max(200).optional().default(''),
  alt: z.string().trim().max(200).optional().default(''),
  isPrimary: z.boolean().optional().default(false)
});

export const updateProductSchema = z
  .object({
    title: z.string().trim().min(2).max(250).optional(),
    description: z.string().trim().max(10000).optional(),
    shortDescription: z.string().trim().max(300).optional(),
    category: objectIdSchema.nullable().optional(),
    brand: objectIdSchema.nullable().optional(),
    status: z.enum(['draft', 'active', 'inactive', 'discontinued']).optional(),
    images: z.array(productImageSchema).max(20).optional(),
    tags: z.array(z.string().trim().max(60)).max(20).optional(),
    variantPrices: z.record(z.coerce.number().min(0)).optional(),
    variantActive: z.record(z.boolean()).optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
