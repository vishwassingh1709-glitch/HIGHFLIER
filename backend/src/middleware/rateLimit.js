import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const createRateLimiter = ({
  windowMs = env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max = env.RATE_LIMIT_MAX,
  message = 'Too many requests, please try again later',
  skipSuccessfulRequests = false
} = {}) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (_req, _res, next) => next(ApiError.tooManyRequests(message)),
    validate: { xForwardedForHeader: false, trustProxy: false }
  });

export const globalRateLimiter = createRateLimiter();

export const authRateLimiter = createRateLimiter({
  max: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many authentication attempts. Please try again later.',
  skipSuccessfulRequests: true
});

export const paymentRateLimiter = createRateLimiter({
  max: env.PAYMENT_RATE_LIMIT_MAX,
  message: 'Too many payment attempts. Please try again later.'
});

export const writeRateLimiter = createRateLimiter({
  max: Math.max(60, Math.floor(env.RATE_LIMIT_MAX / 2)),
  message: 'Too many write requests. Please slow down.'
});
