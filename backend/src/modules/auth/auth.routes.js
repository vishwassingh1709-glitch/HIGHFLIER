import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './auth.controller.js';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailQuerySchema
} from './auth.validators.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, validate(registerSchema), controller.register);
authRouter.post('/login', authRateLimiter, validate(loginSchema), controller.login);
authRouter.post('/refresh', authRateLimiter, validate(refreshSchema), controller.refresh);
authRouter.post('/logout', authenticate, validate(logoutSchema), controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
authRouter.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), controller.resetPassword);
authRouter.get('/verify-email', authRateLimiter, validate(verifyEmailQuerySchema, 'query'), controller.verifyEmail);
authRouter.post(
  '/resend-verification',
  authRateLimiter,
  validate(resendVerificationSchema),
  controller.resendVerification
);
