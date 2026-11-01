import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, API, authHeader, createUser, createAdmin } from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
]);

describe('image uploads without a hosting provider', () => {
  let admin;
  let customer;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    customer = await createUser();
  });

  it('reports upload configuration and requires admin access', async () => {
    const config = await request(app)
      .get(`${API}/admin/uploads/config`)
      .set(authHeader(admin))
      .expect(200);
    expect(config.body.data.configured).toBe(false);
    expect(config.body.data.maxImageBytes).toBe(5 * 1024 * 1024);
    expect(config.body.data.maxImagesPerRequest).toBe(5);

    await request(app).get(`${API}/admin/uploads/config`).expect(401);
    await request(app)
      .get(`${API}/admin/uploads/config`)
      .set(authHeader(customer))
      .expect(403);
  });

  it('returns a clear 503 when storage is not configured', async () => {
    const single = await request(app)
      .post(`${API}/admin/uploads/image`)
      .set(authHeader(admin))
      .field('folder', 'products')
      .attach('file', PNG_BYTES, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(503);
    expect(single.body.error.code).toBe('IMAGE_SERVICE_NOT_CONFIGURED');

    const multiple = await request(app)
      .post(`${API}/admin/uploads/images`)
      .set(authHeader(admin))
      .attach('files', PNG_BYTES, { filename: 'one.png', contentType: 'image/png' })
      .attach('files', PNG_BYTES, { filename: 'two.png', contentType: 'image/png' })
      .expect(503);
    expect(multiple.body.error.code).toBe('IMAGE_SERVICE_NOT_CONFIGURED');

    const remove = await request(app)
      .delete(`${API}/admin/uploads/image`)
      .set(authHeader(admin))
      .send({ publicId: 'highflier/products/example' })
      .expect(503);
    expect(remove.body.error.code).toBe('IMAGE_SERVICE_NOT_CONFIGURED');
  });

  it('validates file types, required fields and folders', async () => {
    const wrongType = await request(app)
      .post(`${API}/admin/uploads/image`)
      .set(authHeader(admin))
      .attach('file', Buffer.from('not an image'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);
    expect(wrongType.body.error.message).toMatch(/unsupported image type/i);

    const missingFile = await request(app)
      .post(`${API}/admin/uploads/image`)
      .set(authHeader(admin))
      .expect(400);
    expect(missingFile.body.error.message).toMatch(/image file is required/i);

    const badFolder = await request(app)
      .post(`${API}/admin/uploads/image`)
      .set(authHeader(admin))
      .field('folder', '../secrets')
      .attach('file', PNG_BYTES, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(422);
    expect(badFolder.body.error.code).toBe('VALIDATION_ERROR');

    const missingPublicId = await request(app)
      .delete(`${API}/admin/uploads/image`)
      .set(authHeader(admin))
      .send({})
      .expect(422);
    expect(missingPublicId.body.error.code).toBe('VALIDATION_ERROR');

    await request(app)
      .post(`${API}/admin/uploads/image`)
      .set(authHeader(customer))
      .attach('file', PNG_BYTES, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(403);
  });
});
