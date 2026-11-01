import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  app,
  API,
  TEST_PASSWORD,
  authHeader,
  createUser,
  createAdmin,
  createMockSupplier,
  createProduct,
  createDeliveredOrder
} from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { buildMockWebhookSignature } from '../src/modules/payments/payments.gateway.js';
import { Product } from '../src/models/Product.js';
import { Session } from '../src/models/Session.js';

describe('admin dashboard, users, reports and logs', () => {
  let admin;
  let customer;
  let supplier;
  let product;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin({ name: 'Platform Admin' });
    customer = await createUser({ name: 'Dashboard Customer' });
    supplier = await createMockSupplier();
    product = await createProduct({ supplier });
  });

  it('protects the admin surface', async () => {
    await request(app).get(`${API}/admin/dashboard`).expect(401);
    await request(app)
      .get(`${API}/admin/dashboard`)
      .set(authHeader(customer))
      .expect(403);
  });

  it('summarises users, products, orders, revenue and supplier health', async () => {
    const delivered = await createDeliveredOrder({ user: customer, product, supplier });
    product.variants[0].stock = 3;
    product.stock = 3;
    await product.save();

    const response = await request(app)
      .get(`${API}/admin/dashboard`)
      .set(authHeader(admin))
      .expect(200);
    const data = response.body.data;

    expect(data.users.total).toBeGreaterThanOrEqual(2);
    expect(data.users.active).toBeGreaterThanOrEqual(2);
    expect(data.products.total).toBeGreaterThanOrEqual(1);
    expect(data.products.lowStock).toBeGreaterThanOrEqual(1);
    expect(data.suppliers.total).toBeGreaterThanOrEqual(1);
    expect(data.orders.total).toBeGreaterThanOrEqual(1);
    expect(data.orders.byStatus.delivered).toBeGreaterThanOrEqual(1);
    expect(data.revenue.grossPaid).toBeGreaterThanOrEqual(delivered.total);
    expect(data.revenue.paidOrders).toBeGreaterThanOrEqual(1);
    expect(data.recentOrders).toHaveLength(1);
  });

  it('manages customers, roles, activation and sessions', async () => {
    const listed = await request(app)
      .get(`${API}/admin/users?q=Dashboard&role=customer`)
      .set(authHeader(admin))
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].passwordHash).toBeUndefined();
    expect(listed.body.meta.total).toBe(1);

    const updated = await request(app)
      .patch(`${API}/admin/users/${customer._id}`)
      .set(authHeader(admin))
      .send({ name: 'Renamed Customer', phone: '9876543210' })
      .expect(200);
    expect(updated.body.data.name).toBe('Renamed Customer');

    const detail = await request(app)
      .get(`${API}/admin/users/${customer._id}`)
      .set(authHeader(admin))
      .expect(200);
    expect(detail.body.data.user.email).toBe(customer.email);
    expect(detail.body.data.stats.orders).toBe(0);

    await request(app)
      .post(`${API}/auth/login`)
      .send({ email: customer.email, password: TEST_PASSWORD })
      .expect(200);
    expect(await Session.countDocuments({ user: customer._id })).toBeGreaterThanOrEqual(1);

    const revoked = await request(app)
      .post(`${API}/admin/users/${customer._id}/revoke-sessions`)
      .set(authHeader(admin))
      .expect(200);
    expect(revoked.body.data.deleted).toBeGreaterThanOrEqual(1);
    expect(await Session.countDocuments({ user: customer._id })).toBe(0);

    const deactivated = await request(app)
      .patch(`${API}/admin/users/${customer._id}`)
      .set(authHeader(admin))
      .send({ isActive: false })
      .expect(200);
    expect(deactivated.body.data.isActive).toBe(false);

    const selfDeactivate = await request(app)
      .patch(`${API}/admin/users/${admin._id}`)
      .set(authHeader(admin))
      .send({ isActive: false })
      .expect(400);
    expect(selfDeactivate.body.error.message).toMatch(/cannot deactivate your own account/i);

    const lastAdmin = await request(app)
      .patch(`${API}/admin/users/${admin._id}`)
      .set(authHeader(admin))
      .send({ role: 'customer' })
      .expect(400);
    expect(lastAdmin.body.error.message).toMatch(/at least one active admin/i);

    const emptyUpdate = await request(app)
      .patch(`${API}/admin/users/${customer._id}`)
      .set(authHeader(admin))
      .send({})
      .expect(422);
    expect(emptyUpdate.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('generates sales, product, low-stock and supplier reports', async () => {
    const delivered = await createDeliveredOrder({ user: customer, product, supplier, quantity: 2 });
    product.variants[0].stock = 2;
    product.stock = 2;
    await product.save();

    const sales = await request(app)
      .get(`${API}/admin/reports/sales`)
      .set(authHeader(admin))
      .expect(200);
    expect(sales.body.data.totals.revenue).toBe(delivered.total);
    expect(sales.body.data.totals.orders).toBe(1);
    expect(sales.body.data.daily.length).toBeGreaterThanOrEqual(1);

    const top = await request(app)
      .get(`${API}/admin/reports/top-products?limit=5`)
      .set(authHeader(admin))
      .expect(200);
    expect(top.body.data[0].productId).toBe(String(product._id));
    expect(top.body.data[0].quantity).toBe(2);

    const lowStock = await request(app)
      .get(`${API}/admin/reports/low-stock?threshold=5`)
      .set(authHeader(admin))
      .expect(200);
    expect(lowStock.body.data[0].productId).toBe(String(product._id));
    expect(lowStock.body.data[0].lowStockVariants[0].stock).toBe(2);

    const performance = await request(app)
      .get(`${API}/admin/reports/suppliers`)
      .set(authHeader(admin))
      .expect(200);
    const row = performance.body.data.find((entry) => String(entry.supplierId) === String(supplier._id));
    expect(row.isMock).toBe(true);

    const badRange = await request(app)
      .get(`${API}/admin/reports/sales?from=2030-01-01&to=2020-01-01`)
      .set(authHeader(admin))
      .expect(400);
    expect(badRange.body.error.message).toMatch(/from must be before to/i);
  });

  it('exposes audit, webhook and supplier sync logs', async () => {
    await request(app)
      .patch(`${API}/admin/users/${customer._id}`)
      .set(authHeader(admin))
      .send({ name: 'Audit Me' })
      .expect(200);

    const audits = await request(app)
      .get(`${API}/admin/audit-logs?action=user.update`)
      .set(authHeader(admin))
      .expect(200);
    expect(audits.body.data.length).toBeGreaterThanOrEqual(1);
    expect(audits.body.data[0].actor.email).toBe(admin.email);

    const raw = JSON.stringify({
      event_id: 'evt_log_test',
      event: 'payment.authorized',
      payload: { payment: { entity: { id: 'pay_unmatched_log' } } }
    });
    await request(app)
      .post(`${API}/payments/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', buildMockWebhookSignature(raw))
      .send(raw)
      .expect(200);

    const webhooks = await request(app)
      .get(`${API}/admin/webhook-logs?provider=mock`)
      .set(authHeader(admin))
      .expect(200);
    expect(webhooks.body.data.length).toBeGreaterThanOrEqual(1);
    expect(webhooks.body.data[0].eventId).toBe('evt_log_test');

    await request(app)
      .post(`${API}/admin/suppliers/${supplier._id}/sync/catalogue`)
      .set(authHeader(admin))
      .send({ maxPages: 1 })
      .expect(200);

    const syncLogs = await request(app)
      .get(`${API}/admin/sync-logs?supplierId=${supplier._id}&type=catalogue`)
      .set(authHeader(admin))
      .expect(200);
    expect(syncLogs.body.data.length).toBeGreaterThanOrEqual(1);
    expect(syncLogs.body.data[0].status).toBe('success');
  });
});
