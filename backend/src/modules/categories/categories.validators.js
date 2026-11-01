import { z } from 'zod';
import { objectIdSchema } from '../../validators/common.js';

const imageSchema = z.object({
  url: z.string().trim().url().or(z.literal('')).optional().default(''),
  alt: z.string().trim().max(200).optional().default('')
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().default(''),
  parentCategory: objectIdSchema.nullable().optional(),
  image: imageSchema.optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional().default(0)
});

export const updateCategorySchema = createCategorySchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required'
);

export const createBrandSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().default(''),
  logo: z
    .object({
      url: z.string().trim().url().or(z.literal('')).optional().default(''),
      publicId: z.string().trim().max(200).optional().default(''),
      alt: z.string().trim().max(200).optional().default('')
    })
    .optional(),
  isActive: z.boolean().optional().default(true)
});

export const updateBrandSchema = createBrandSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required'
);

export const slugParamSchema = z.object({
  slug: z.string().trim().min(1).max(160)
});
