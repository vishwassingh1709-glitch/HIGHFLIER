import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/highflier_test_placeholder',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
      JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef0123456789',
      APP_ENCRYPTION_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      PAYMENTS_MOCK_MODE: 'true',
      PAYMENT_MOCK_SECRET: 'test-mock-payment-secret-0123456789',
      JOBS_ENABLED: 'false',
      LOG_LEVEL: 'silent',
      REQUIRE_EMAIL_VERIFICATION: 'false',
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
      PAYMENT_RATE_LIMIT_MAX: '100000',
      SUPPLIER_ALLOWED_HOSTS: 'api.supplier.test,supplier.example.com',
      RETURN_WINDOW_DAYS: '7',
      ORDER_RESERVATION_TTL_MINUTES: '15'
    }
  }
});
