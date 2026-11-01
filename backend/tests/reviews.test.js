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
  createDeliveredOrder
} from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { Product } from '../src/models/Product.js';

describe('verified purchase reviews', () => {
  let admin;
  let user;
  let otherUser;
  let supplier;
  let product;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    user = await createUser({ name: 'Reviewer One' });
    otherUser = await createUser({ name: 'Reviewer Two' });
    supplier = await createMockSupplier();
    product = await createProduct({ supplier });
    await createDeliveredOrder({ user, product, supplier });
  });

  const submitReview = (payload, targetUser = user) =>
    request(app)
      .post(`${API}/reviews/product/${product._id}`)
      .set(authHeader(targetUser))
      .send(payload);

  it('only allows verified purchasers to review once with valid ratings', async () => {
    const forbidden = await submitReview({ rating: 5, comment: 'Great product' }, otherUser).expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const invalid = await submitReview({ rating: 6, comment: 'Too many stars' }).expect(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const created = await submitReview({
      rating: 5,
      title: 'Excellent',
      comment: 'Exactly as described, fast delivery.'
    }).expect(201);
    expect(created.body.data.review.rating).toBe(5);
    expect(created.body.data.review.isVerifiedPurchase).toBe(true);
    expect(created.body.data.review.status).toBe('approved');
    expect(created.body.data.product).toEqual({ ratingAverage: 5, ratingCount: 1 });

    const stored = await Product.findById(product._id);
    expect(stored.ratingAverage).toBe(5);
    expect(stored.ratingCount).toBe(1);

    const duplicate = await submitReview({ rating: 4, comment: 'Second attempt' }).expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('serves public review lists with summaries, filtering and ownership flags', async () => {
    await submitReview({ rating: 5, comment: 'Top marks' }).expect(201);
    await submitReview({ rating: 3, comment: 'Mixed feelings' }, user).expect(409);

    const publicList = await request(app)
      .get(`${API}/reviews/product/${product._id}?sort=highest&rating=5`)
      .expect(200);
    expect(publicList.body.data.reviews).toHaveLength(1);
    expect(publicList.body.data.reviews[0].author.name).toBe('Reviewer One');
    expect(publicList.body.data.reviews[0].mine).toBe(false);
    expect(publicList.body.data.summary.total).toBe(1);
    expect(publicList.body.data.summary.distribution['5']).toBe(1);
    expect(publicList.body.meta.total).toBe(1);

    const authenticated = await request(app)
      .get(`${API}/reviews/product/${product._id}`)
      .set(authHeader(user))
      .expect(200);
    expect(authenticated.body.data.reviews[0].mine).toBe(true);

    const mine = await request(app)
      .get(`${API}/reviews/me`)
      .set(authHeader(user))
      .expect(200);
    expect(mine.body.data.reviews).toHaveLength(1);
    expect(mine.body.data.reviews[0].product.slug).toBe(product.slug);
  });

  it('lets customers update and delete their own review with rating recalculation', async () => {
    const created = await submitReview({ rating: 5, comment: 'Loved it' }).expect(201);
    const reviewId = created.body.data.review.id;

    const updated = await request(app)
      .patch(`${API}/reviews/${reviewId}`)
      .set(authHeader(user))
      .send({ rating: 3, comment: 'Revised opinion' })
      .expect(200);
    expect(updated.body.data.review.rating).toBe(3);
    expect((await Product.findById(product._id)).ratingAverage).toBe(3);

    const notOwner = await request(app)
      .patch(`${API}/reviews/${reviewId}`)
      .set(authHeader(otherUser))
      .send({ rating: 1 })
      .expect(404);
    expect(notOwner.body.error.code).toBe('NOT_FOUND');

    const deleted = await request(app)
      .delete(`${API}/reviews/${reviewId}`)
      .set(authHeader(user))
      .expect(200);
    expect(deleted.body.data.product).toEqual({ ratingAverage: 0, ratingCount: 0 });

    await request(app)
      .delete(`${API}/reviews/${reviewId}`)
      .set(authHeader(user))
      .expect(404);
  });

  it('moderates reviews and recalculates public ratings', async () => {
    const created = await submitReview({ rating: 4, comment: 'Solid' }).expect(201);
    const reviewId = created.body.data.review.id;

    const adminList = await request(app)
      .get(`${API}/admin/reviews?product=${product._id}`)
      .set(authHeader(admin))
      .expect(200);
    expect(adminList.body.data.reviews).toHaveLength(1);

    const rejected = await request(app)
      .patch(`${API}/admin/reviews/${reviewId}`)
      .set(authHeader(admin))
      .send({ status: 'rejected', note: 'Contains personal data' })
      .expect(200);
    expect(rejected.body.data.review.status).toBe('rejected');
    expect(rejected.body.data.product.ratingCount).toBe(0);

    const publicAfterReject = await request(app)
      .get(`${API}/reviews/product/${product._id}`)
      .expect(200);
    expect(publicAfterReject.body.data.reviews).toHaveLength(0);
    expect(publicAfterReject.body.data.summary.total).toBe(0);

    const auditLogs = await request(app)
      .get(`${API}/admin/audit-logs?action=review.rejected`)
      .set(authHeader(admin))
      .expect(200);
    expect(auditLogs.body.data.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs.body.data[0].actor._id).toBe(String(admin._id));

    await request(app)
      .patch(`${API}/admin/reviews/${reviewId}`)
      .set(authHeader(admin))
      .send({ status: 'approved' })
      .expect(200);
    const publicAfterApprove = await request(app)
      .get(`${API}/reviews/product/${product._id}`)
      .expect(200);
    expect(publicAfterApprove.body.data.summary.total).toBe(1);

    await request(app)
      .delete(`${API}/admin/reviews/${reviewId}`)
      .set(authHeader(admin))
      .expect(200);
    expect((await Product.findById(product._id)).ratingCount).toBe(0);
  });

  it('restricts admin review moderation to admins', async () => {
    await request(app).get(`${API}/admin/reviews`).expect(401);
    await request(app)
      .get(`${API}/admin/reviews`)
      .set(authHeader(user))
      .expect(403);
  });
});
