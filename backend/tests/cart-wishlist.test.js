import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, API, authHeader, createUser, createMockSupplier, createProduct } from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { Product } from '../src/models/Product.js';

describe('cart and wishlist', () => {
  let user;
  let supplier;
  let product;
  let sku;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  beforeEach(async () => {
    await resetDatabase();
    user = await createUser();
    supplier = await createMockSupplier();
    product = await createProduct({ supplier });
    sku = product.variants[0].sku;
  });

  const addToCart = (overrides = {}) =>
    request(app)
      .post(`${API}/cart`)
      .set(authHeader(user))
      .send({ productId: product._id.toString(), sku, quantity: 1, ...overrides });

  it('requires authentication for cart and wishlist access', async () => {
    await request(app).get(`${API}/cart`).expect(401);
    await request(app).get(`${API}/wishlist`).expect(401);
  });

  it('adds items, merges duplicates and recalculates totals server-side', async () => {
    const first = await addToCart({ quantity: 2 }).expect(201);
    expect(first.body.data.itemCount).toBe(2);
    expect(first.body.data.subtotal).toBe(300);

    const second = await addToCart({ quantity: 1 }).expect(201);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.itemCount).toBe(3);
    expect(second.body.data.subtotal).toBe(450);
    expect(second.body.data.items[0].product.supplierCost).toBeUndefined();

    product.variants[0].sellingPrice = 175;
    product.sellingPrice = 175;
    await product.save();

    const live = await request(app).get(`${API}/cart`).set(authHeader(user)).expect(200);
    expect(live.body.data.items[0].variant.unitPrice).toBe(175);
    expect(live.body.data.subtotal).toBe(525);
  });

  it('rejects unavailable products and insufficient stock', async () => {
    const scarce = await createProduct({ supplier, overrides: { stock: 1 } });
    const scarceSku = scarce.variants[0].sku;
    scarce.variants[0].stock = 1;
    await scarce.save();

    const insufficient = await request(app)
      .post(`${API}/cart`)
      .set(authHeader(user))
      .send({ productId: scarce._id.toString(), sku: scarceSku, quantity: 2 })
      .expect(409);
    expect(insufficient.body.error.code).toBe('INSUFFICIENT_STOCK');

    product.status = 'draft';
    await product.save();
    const unavailable = await addToCart().expect(409);
    expect(unavailable.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('updates quantities, removes lines and clears the cart', async () => {
    await addToCart({ quantity: 2 }).expect(201);

    const updated = await request(app)
      .patch(`${API}/cart/items/${product._id}/${encodeURIComponent(sku)}`)
      .set(authHeader(user))
      .send({ quantity: 5 })
      .expect(200);
    expect(updated.body.data.itemCount).toBe(5);

    const removedByZero = await request(app)
      .patch(`${API}/cart/items/${product._id}/${encodeURIComponent(sku)}`)
      .set(authHeader(user))
      .send({ quantity: 0 })
      .expect(200);
    expect(removedByZero.body.data.items).toHaveLength(0);

    await addToCart().expect(201);
    const removed = await request(app)
      .delete(`${API}/cart/items/${product._id}/${encodeURIComponent(sku)}`)
      .set(authHeader(user))
      .expect(200);
    expect(removed.body.data.items).toHaveLength(0);

    await addToCart().expect(201);
    const cleared = await request(app).delete(`${API}/cart`).set(authHeader(user)).expect(200);
    expect(cleared.body.data.lineCount).toBe(0);
  });

  it('flags stale cart lines without charging for them', async () => {
    await addToCart({ quantity: 2 }).expect(201);
    product.variants[0].isActive = false;
    await product.save();

    const cart = await request(app).get(`${API}/cart`).set(authHeader(user)).expect(200);
    expect(cart.body.data.items[0].isPurchasable).toBe(false);
    expect(cart.body.data.items[0].issue).toMatch(/inactive/i);
    expect(cart.body.data.subtotal).toBe(0);
  });

  it('validates cart payloads', async () => {
    await request(app)
      .post(`${API}/cart`)
      .set(authHeader(user))
      .send({ productId: 'not-an-id', sku, quantity: 1 })
      .expect(422);
    await request(app)
      .post(`${API}/cart`)
      .set(authHeader(user))
      .send({ productId: product._id.toString(), sku, quantity: 0 })
      .expect(422);
  });

  it('manages the wishlist without duplicates', async () => {
    const added = await request(app)
      .post(`${API}/wishlist`)
      .set(authHeader(user))
      .send({ productId: product._id.toString() })
      .expect(201);
    expect(added.body.data.count).toBe(1);

    const duplicate = await request(app)
      .post(`${API}/wishlist`)
      .set(authHeader(user))
      .send({ productId: product._id.toString() })
      .expect(201);
    expect(duplicate.body.data.count).toBe(1);

    const listed = await request(app).get(`${API}/wishlist`).set(authHeader(user)).expect(200);
    expect(listed.body.data.products[0].title).toBe(product.title);

    const removed = await request(app)
      .delete(`${API}/wishlist/${product._id}`)
      .set(authHeader(user))
      .expect(200);
    expect(removed.body.data.count).toBe(0);

    await request(app)
      .post(`${API}/wishlist`)
      .set(authHeader(user))
      .send({ productId: product._id.toString() })
      .expect(201);
    const cleared = await request(app).delete(`${API}/wishlist`).set(authHeader(user)).expect(200);
    expect(cleared.body.data.count).toBe(0);
  });

  it('will not wishlist discontinued products', async () => {
    const draft = await createProduct({ supplier, overrides: { status: 'draft' } });
    await request(app)
      .post(`${API}/wishlist`)
      .set(authHeader(user))
      .send({ productId: draft._id.toString() })
      .expect(404);
  });
});
