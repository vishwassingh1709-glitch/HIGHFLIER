import dotenv from 'dotenv';
import { z } from 'zod';
import crypto from 'node:crypto';

dotenv.config();

const boolFromEnv = (defaultValue = false) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  }, z.boolean());

const intFromEnv = (defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : Number(value)),
    z.number().int().min(min).max(max)
  );

const isValidEncryptionKey = (key) => {
  if (!key) return false;
  if (/^[0-9a-f]{64}$/i.test(key)) return true;
  try {
    return Buffer.from(key, 'base64').length === 32;
  } catch {
    return false;
  }
};

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: intFromEnv(5000, 1, 65535),
    API_BASE_URL: z.string().url().default('http://localhost:5000'),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    MONGODB_DB_NAME: z.string().optional(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),
    APP_ENCRYPTION_KEY: z
      .string()
      .refine(isValidEncryptionKey, 'APP_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters'),

    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    TRUST_PROXY: boolFromEnv(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    RATE_LIMIT_WINDOW_MINUTES: intFromEnv(15, 1, 1440),
    RATE_LIMIT_MAX: intFromEnv(300, 1, 100000),
    AUTH_RATE_LIMIT_MAX: intFromEnv(20, 1, 100000),
    PAYMENT_RATE_LIMIT_MAX: intFromEnv(30, 1, 100000),

    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().min(10).optional(),
    ADMIN_NAME: z.string().default('HIGHFLIER Admin'),

    REQUIRE_EMAIL_VERIFICATION: boolFromEnv(false),
    PASSWORD_RESET_TTL_MINUTES: intFromEnv(30, 5, 1440),
    EMAIL_VERIFICATION_TTL_HOURS: intFromEnv(24, 1, 168),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    PAYMENTS_MOCK_MODE: boolFromEnv(false),
    PAYMENT_MOCK_SECRET: z.string().min(16).optional(),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_FOLDER: z.string().default('highflier'),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_SECURE: boolFromEnv(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('HIGHFLIER <no-reply@highflier.local>'),

    SUPPLIER_ALLOWED_HOSTS: z.string().default(''),
    SUPPLIER_HTTP_TIMEOUT_MS: intFromEnv(15000, 1000, 120000),
    AUTO_ACTIVATE_IMPORTED_PRODUCTS: boolFromEnv(false),
    STALE_INVENTORY_HOURS: intFromEnv(24, 1, 720),

    SHIPPING_FEE_INR: z.coerce.number().min(0).default(49),
    FREE_SHIPPING_THRESHOLD_INR: z.coerce.number().min(0).default(999),
    COD_FEE_INR: z.coerce.number().min(0).default(0),
    TAX_PERCENT: z.coerce.number().min(0).max(100).default(0),
    ORDER_RESERVATION_TTL_MINUTES: intFromEnv(15, 1, 1440),
    RETURN_WINDOW_DAYS: intFromEnv(7, 0, 90),
    MAX_PAGE_SIZE: intFromEnv(100, 1, 500),

    JOBS_ENABLED: boolFromEnv(true),
    CATALOGUE_SYNC_CRON: z.string().default('0 * * * *'),
    INVENTORY_SYNC_CRON: z.string().default('*/15 * * * *'),
    SUPPLIER_ORDER_RETRY_CRON: z.string().default('*/5 * * * *'),
    SUPPLIER_STATUS_SYNC_CRON: z.string().default('*/10 * * * *'),
    RESERVATION_EXPIRY_CRON: z.string().default('* * * * *')
  })
  .superRefine((value, ctx) => {
    if (value.PAYMENTS_MOCK_MODE && !value.PAYMENT_MOCK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_MOCK_SECRET'],
        message: 'PAYMENT_MOCK_SECRET is required when PAYMENTS_MOCK_MODE=true'
      });
    }
    if (value.PAYMENTS_MOCK_MODE && value.NODE_ENV === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENTS_MOCK_MODE'],
        message: 'Mock payments must never be enabled in production'
      });
    }
    if (!value.PAYMENTS_MOCK_MODE) {
      const missing = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'].filter(
        (key) => !value[key]
      );
      if (value.NODE_ENV === 'production' && missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_KEY_ID'],
          message: `Razorpay credentials required in production: missing ${missing.join(', ')}`
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  // Never print secret values, only variable names and validation messages.
  console.error(`[HIGHFLIER] Invalid environment configuration:\n${issues}`);
  throw new Error('Invalid environment configuration. See .env.example and the messages above.');
}

const raw = parsed.data;

const normalizeEncryptionKey = (key) => {
  if (/^[0-9a-f]{64}$/i.test(key)) return Buffer.from(key, 'hex');
  return Buffer.from(key, 'base64');
};

export const env = Object.freeze({
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  supplierAllowedHosts: raw.SUPPLIER_ALLOWED_HOSTS.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  encryptionKey: normalizeEncryptionKey(raw.APP_ENCRYPTION_KEY),
  mockPaymentSecret:
    raw.PAYMENT_MOCK_SECRET || (raw.NODE_ENV === 'production' ? undefined : 'highflier_mock_payment_secret_change_me')
});

export const isCloudinaryConfigured = Boolean(
  raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET
);

export const isSmtpConfigured = Boolean(raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASS);

export const isRazorpayConfigured = Boolean(raw.RAZORPAY_KEY_ID && raw.RAZORPAY_KEY_SECRET);

export const generateEncryptionKeyExample = () => crypto.randomBytes(32).toString('base64');
