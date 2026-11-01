import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.PAYMENTS_MOCK_MODE = 'false';
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.RAZORPAY_WEBHOOK_SECRET;

const { setupTestDatabase, teardownTestDatabase, resetDatabase } = await import('./helpers/db.js');
const {
  app,
  API,
  authHeader,
  createUser,
  addAddress,
  createMockSupplier,
  createProduct,
  orderItem
} = await import('./helpers/fixtures.js');

describe('payments without a configured gateway', () => {
  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  it('reports no gateway and blocks online checkout while COD still works', async () => {
    await resetDatabase();
    const user = await createUser();
    const address = await addAddress(user);
    const supplier = await createMockSupplier();
    const product = await createProduct({ supplier });

    const config = await request(app)
      .get(`${API}/payments/config`)
      .set(authHeader(user))
      .expect(200);
    expect(config.body.data).toMatchObject({ mode: 'none', provider: null, configured: false });

    const online = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .send({
        paymentMethod: 'online',
        addressId: address._id.toString(),
        items: [orderItem(product, null, 1)]
      })
      .expect(503);
    expect(online.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');

    const cod = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .send({
        paymentMethod: 'cod',
        addressId: address._id.toString(),
        items: [orderItem(product, null, 1)]
      })
      .expect(201);
    expect(cod.body.data.order.paymentMethod).toBe('cod');
  });
});
