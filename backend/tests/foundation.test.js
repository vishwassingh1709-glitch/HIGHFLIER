import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, API } from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';

describe('foundation, health and error handling', () => {
  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);
  beforeEach(resetDatabase);

  it('serves the service descriptor and health endpoints', async () => {
    const root = await request(app).get('/').expect(200);
    expect(root.body.success).toBe(true);
    expect(root.body.data.apiBase).toBe(API);

    const health = await request(app).get(`${API}/health`).expect(200);
    expect(health.body.data.status).toBe('ok');

    const ready = await request(app).get(`${API}/health/ready`).expect(200);
    expect(ready.body.data.status).toBe('ready');
  });

  it('serves the OpenAPI document and Swagger UI', async () => {
    const spec = await request(app).get('/api-docs.json').expect(200);
    expect(spec.body.openapi).toBe('3.0.3');
    expect(spec.body.servers[0].url).toBe('/api/v1');
    expect(Object.keys(spec.body.paths).length).toBeGreaterThan(50);
    expect(spec.body.paths['/orders/checkout'].post.responses).toHaveProperty('201');

    const ui = await request(app).get('/api-docs/').expect(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('applies security headers and hides Express', async () => {
    const response = await request(app).get(`${API}/health`).expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app).get(`${API}/does-not-exist`).expect(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('rejects malformed JSON with a validation error', async () => {
    const response = await request(app)
      .post(`${API}/auth/register`)
      .set('Content-Type', 'application/json')
      .send('{"name": "Broken",')
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('strips NoSQL operator injection and fails validation safely', async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: { $ne: null }, password: 'Password123' })
      .expect(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(response.body.error.details)).toBe(true);
  });

  it('rejects tampered access tokens', async () => {
    const response = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});
