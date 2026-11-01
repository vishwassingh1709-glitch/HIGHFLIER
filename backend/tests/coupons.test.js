import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  app,
  API,
  authHeader,
  createUser,
  createAdmin,
  createMockSupplier,
  createProduct,
  createCoupon
} from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { Coupon } from '../src/models/Coupon.js';

describe('coupons', () => {
  let admin;
  let user;
  let supplier;
  let product;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    user = await createUser();
    supplier = await createMockSupplier();
    product = await createProduct({ supplier });
  });

  const createViaApi = (payload) =>
    request(app)
      .post(`${API}/admin/coupons`)
      .set(authHeader(admin))
      .send(payload);

  const addProductToCart = async () => {
    await request(app)
      .post(`${API}/cart`)
      .set(authHeader(user))
      .send({ productId: product._id.toString(), sku: product.variants[0].sku, quantity: 2 })
      .expect(201);
  };

  it('lets admins create coupons and blocks duplicate codes', async () => {
    const created = await createViaApi({
      code: 'save20',
      discountType: 'percent',
      discountValue: 20,
      maxDiscount: 100
    }).expect(201);
    expect(created.body.data.code).toBe('SAVE20');

    const duplicate = await createViaApi({
      code: 'SAVE20',
      discountType: 'percent',
      discountValue: 10
    }).expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const invalid = await createViaApi({
      code: 'BAD',
      discountType: 'percent',
      discountValue: 150
    }).expect(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates a coupon against the live cart', async () => {
    await createViaApi({
      code: 'TAKE10',
      discountType: 'percent',
      discountValue: 10
    }).expect(201);
    await addProductToCart();

    // 2 x 150 = 300, 10% = 30
    const valid = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: 'take10' })
      .expect(200);
    expect(valid.body.data.subtotal).toBe(300);
    expect(valid.body.data.discount).toBe(30);

    const invalid = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: 'NOPE' })
      .expect(400);
    expect(invalid.body.error.code).toBe('INVALID_COUPON');
  });

  it('enforces minimum order value, expiry, scope and usage limits', async () => {
    await createViaApi({
      code: 'BIGSPEND',
      discountType: 'fixed',
      discountValue: 50,
      minOrderValue: 1000
    }).expect(201);

    const expired = await createCoupon({
      code: 'OLD10',
      expiresAt: new Date(Date.now() - 60_000)
    });
    const exhausted = await createCoupon({
      code: 'GONE10',
      usageLimit: 1,
      usedCount: 1
    });
    const otherCategory = await createCoupon({
      code: 'CATONLY',
      scope: 'category',
      categories: [product._id]
    });

    await addProductToCart();

    const belowMinimum = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: 'BIGSPEND' })
      .expect(400);
    expect(belowMinimum.body.error.message).toMatch(/minimum order value/i);

    const expiredResponse = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: expired.code })
      .expect(400);
    expect(expiredResponse.body.error.message).toMatch(/expired/i);

    const exhaustedResponse = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: exhausted.code })
      .expect(400);
    expect(exhaustedResponse.body.error.message).toMatch(/usage limit/i);

    const wrongScope = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: otherCategory.code })
      .expect(400);
    expect(wrongScope.body.error.message).toMatch(/does not apply/i);
  });

  it('caps percentage discounts with maxDiscount and never exceeds subtotal', async () => {
    await createCoupon({ code: 'CAP25', discountValue: 25, maxDiscount: 40 });
    await addProductToCart();

    const capped = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: 'CAP25' })
      .expect(200);
    expect(capped.body.data.discount).toBe(40);

    await createCoupon({ code: 'HUGE', discountType: 'fixed', discountValue: 10_000 });
    const floored = await request(app)
      .post(`${API}/coupons/validate`)
      .set(authHeader(user))
      .send({ code: 'HUGE' })
      .expect(200);
    expect(floored.body.data.discount).toBe(300);
  });

  it('supports admin listing, updates and deactivation', async () => {
    const coupon = await createCoupon({ code: 'LISTME' });

    const listed = await request(app)
      .get(`${API}/admin/coupons?q=LISTME`)
      .set(authHeader(admin))
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.meta.total).toBe(1);

    const updated = await request(app)
      .patch(`${API}/admin/coupons/${coupon._id}`)
      .set(authHeader(admin))
      .send({ discountValue: 33, description: 'Updated' })
      .expect(200);
    expect(updated.body.data.discountValue).toBe(33);

    await request(app)
      .delete(`${API}/admin/coupons/${coupon._id}`)
      .set(authHeader(admin))
      .expect(200);
    const stored = await Coupon.findById(coupon._id);
    expect(stored.isActive).toBe(false);

    await request(app).get(`${API}/admin/coupons`).expect(401);
    await request(app)
      .get(`${API}/admin/coupons`)
      .set(authHeader(user))
      .expect(403);
  });
});
