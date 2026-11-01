import { z } from 'zod';

export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid MongoDB ObjectId');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email is invalid')
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, 'Phone must be a valid Indian mobile number');

export const pincodeSchema = z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits');

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  fullName: z.string().trim().min(2, 'Full name is required').max(100),
  phone: phoneSchema,
  line1: z.string().trim().min(3, 'Address line 1 is required').max(200),
  line2: z.string().trim().max(200).optional().default(''),
  landmark: z.string().trim().max(100).optional().default(''),
  city: z.string().trim().min(2, 'City is required').max(100),
  state: z.string().trim().min(2, 'State is required').max(100),
  pincode: pincodeSchema,
  country: z.string().trim().max(60).optional().default('India'),
  isDefault: z.boolean().optional().default(false)
});

export const addressUpdateSchema = addressSchema.partial();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const idParamSchema = z.object({ id: objectIdSchema });

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');
