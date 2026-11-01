import { describe, expect, it } from 'vitest';
import { createCorsOptions } from '../src/app.js';

const isAllowed = (options, origin) =>
  new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => (error ? reject(error) : resolve(allowed)));
  });

describe('CORS origin policy', () => {
  it('allows the Swagger UI origin in development', async () => {
    const options = createCorsOptions({
      corsOrigins: ['http://localhost:5173'],
      isDevelopment: true,
      isTest: false
    });

    await expect(isAllowed(options, 'http://localhost:5000')).resolves.toBe(true);
    await expect(isAllowed(options, 'http://localhost:5000/')).rejects.toThrow(
      'Origin http://localhost:5000/ is not allowed by CORS'
    );
  });

  it('does not add the development origin to the production allowlist', async () => {
    const options = createCorsOptions({
      corsOrigins: ['https://shop.example.com'],
      isDevelopment: false,
      isTest: false
    });

    await expect(isAllowed(options, 'https://shop.example.com')).resolves.toBe(true);
    await expect(isAllowed(options, 'http://localhost:5000')).rejects.toThrow(
      'Origin http://localhost:5000 is not allowed by CORS'
    );
  });
});
