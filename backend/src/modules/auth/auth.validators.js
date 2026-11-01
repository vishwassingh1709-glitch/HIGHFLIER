import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema } from '../../validators/common.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional()
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token is required')
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
  allDevices: z.boolean().optional().default(false)
});

export const forgotPasswordSchema = z.object({
  email: emailSchema
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'Reset token is required'),
  password: passwordSchema
});

export const verifyEmailQuerySchema = z.object({
  token: z.string().min(20, 'Verification token is required')
});

export const resendVerificationSchema = z.object({
  email: emailSchema
});
