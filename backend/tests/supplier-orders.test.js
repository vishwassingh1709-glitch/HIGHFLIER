import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  app,
  API,
  authHeader,
  createUser,
  createAdmin,
  addAddress,
  createMockSupplier,
  createProduct,
  orderItem
} from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { MOCK_SUPPLIER_CAPABILITIES } from '../src/modules/suppliers/adapters/mockAdapter.js';
import { Supplier } from '../src/models/Supplier.js';

const SLOW_TIMELINE = { mockTimelineSeconds: { processing: 3600, shipped: 7200, delivered: 10800 } };

describe('supplier order forwarding and fulfilment sync', () => {
  let admin;
  let user;
  let supplier;
  let product;
  let address;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    user = await createUser();
    address = await addAddress(user);
    supplier = await createMockSupplier({ config: SLOW_TIMELINE });
    product = await createProduct({ supplier });
  });

  const placeCodOrder = async (items = [orderItem(product, null, 1)], targetUser = user, targetAddress = address) => {
    const response = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(targetUser))
      .send({
        paymentMethod: 'cod',
        addressId: targetAddress._id.toString(),
        items
      })
      .expect(201);
    return response.body.data.order;
  };

  const listSupplierOrders = async (query = '') =>
    request(app)
      .get(`${API}/admin/supplier-orders${query}`)
      .set(authHeader(admin))
      .expect(200);

  it('forwards a paid order to the mock supplier and exposes admin views', async () => {
    const order = await placeCodOrder();

    const listed = await listSupplierOrders(`?orderId=${order._id}`);
    expect(listed.body.data).toHaveLength(1);
    const supplierOrder = listed.body.data[0];
    expect(supplierOrder.status).toBe('accepted');
    expect(supplierOrder.isMock).toBe(true);
    expect(supplierOrder.supplierOrderId).toMatch(/^MOCK-SO-/);
    expect(supplierOrder.idempotencyKey).toBe(`hf:${order.orderNumber}:${supplier._id}`);
    expect(supplierOrder.supplier.credentials).toBeUndefined();

    const detail = await request(app)
      .get(`${API}/admin/supplier-orders/${supplierOrder._id}`)
      .set(authHeader(admin))
      .expect(200);
    expect(detail.body.data.items[0].title).toBe(product.title);
    expect(detail.body.data.requestPayload.items[0].sku).toBe(product.variants[0].sku);

    const stats = await request(app)
      .get(`${API}/admin/supplier-orders/stats`)
      .set(authHeader(admin))
      .expect(200);
    expect(stats.body.data.accepted).toBe(1);

    await request(app)
      .get(`${API}/admin/supplier-orders`)
      .set(authHeader(user))
      .expect(403);
  });

  it('groups a multi-supplier order into one supplier order per supplier', async () => {
    const secondSupplier = await createMockSupplier({ config: SLOW_TIMELINE });
    const secondProduct = await createProduct({ supplier: secondSupplier });

    const order = await placeCodOrder([
      orderItem(product, null, 1),
      orderItem(secondProduct, null, 2)
    ]);

    const listed = await listSupplierOrders(`?orderId=${order._id}`);
    expect(listed.body.data).toHaveLength(2);
    const supplierIds = listed.body.data.map((entry) => String(entry.supplier._id)).sort();
    expect(supplierIds).toEqual([String(supplier._id), String(secondSupplier._id)].sort());
    const quantities = listed.body.data.map((entry) => entry.items.reduce((sum, item) => sum + item.quantity, 0));
    expect(quantities.sort()).toEqual([1, 2]);
  });

  it('syncs processing, shipped and delivered states together with mock tracking', async () => {
    const order = await placeCodOrder();
    const supplierOrder = (await listSupplierOrders(`?orderId=${order._id}`)).body.data[0];

    await Supplier.updateOne(
      { _id: supplier._id },
      { $set: { 'config.mockTimelineSeconds': { processing: 0, shipped: 3600, delivered: 10800 } } }
    );
    const processing = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/sync`)
      .set(authHeader(admin))
      .expect(200);
    expect(processing.body.data.status).toBe('processing');

    await Supplier.updateOne(
      { _id: supplier._id },
      { $set: { 'config.mockTimelineSeconds': { processing: 0, shipped: 0, delivered: 3600 } } }
    );
    const shipped = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/sync`)
      .set(authHeader(admin))
      .expect(200);
    expect(shipped.body.data.status).toBe('shipped');
    expect(shipped.body.data.tracking.courier).toBe('MockExpress (demo)');
    expect(shipped.body.data.tracking.isMock).toBe(true);

    let orderResponse = await request(app)
      .get(`${API}/orders/${order._id}`)
      .set(authHeader(user))
      .expect(200);
    expect(orderResponse.body.data.status).toBe('shipped');
    expect(orderResponse.body.data.tracking.trackingNumber).toMatch(/^MOCKTRK-/);

    await Supplier.updateOne(
      { _id: supplier._id },
      { $set: { 'config.mockTimelineSeconds': { processing: 0, shipped: 0, delivered: 0 } } }
    );
    const delivered = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/sync`)
      .set(authHeader(admin))
      .expect(200);
    expect(delivered.body.data.status).toBe('delivered');

    orderResponse = await request(app)
      .get(`${API}/orders/${order._id}`)
      .set(authHeader(user))
      .expect(200);
    expect(orderResponse.body.data.status).toBe('delivered');
    expect(orderResponse.body.data.paymentStatus).toBe('captured');
    expect(orderResponse.body.data.amountPaid).toBe(orderResponse.body.data.total);

    const stats = await request(app)
      .get(`${API}/admin/supplier-orders/stats`)
      .set(authHeader(admin))
      .expect(200);
    expect(stats.body.data.delivered).toBe(1);

    const cannotCancel = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/cancel`)
      .set(authHeader(admin))
      .send({ reason: 'Too late' })
      .expect(409);
    expect(cannotCancel.body.error.message).toMatch(/delivered/i);
  });

  it('flags suppliers without order-placement capability and retries them safely', async () => {
    const manualSupplier = await createMockSupplier({
      config: SLOW_TIMELINE,
      capabilities: { ...MOCK_SUPPLIER_CAPABILITIES, orderPlacement: false }
    });
    const manualProduct = await createProduct({ supplier: manualSupplier });

    const order = await placeCodOrder([orderItem(manualProduct, null, 1)]);
    const listed = await listSupplierOrders(`?orderId=${order._id}&needsAttention=true`);
    expect(listed.body.data).toHaveLength(1);
    const supplierOrder = listed.body.data[0];
    expect(supplierOrder.status).toBe('action_required');
    expect(supplierOrder.lastError).toMatch(/no order placement API capability/i);

    const orderResponse = await request(app)
      .get(`${API}/admin/orders/${order._id}`)
      .set(authHeader(admin))
      .expect(200);
    expect(orderResponse.body.data.fulfilmentIssue.required).toBe(true);

    const retried = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/retry`)
      .set(authHeader(admin))
      .expect(200);
    expect(retried.body.data.status).toBe('action_required');
    expect(retried.body.data.lastError).toMatch(/does not support order placement/i);

    const due = await request(app)
      .post(`${API}/admin/supplier-orders/retry-due`)
      .set(authHeader(admin))
      .expect(200);
    expect(due.body.data.attempted).toBe(0);
  });

  it('cancels a supplier order through the admin API', async () => {
    const order = await placeCodOrder();
    const supplierOrder = (await listSupplierOrders(`?orderId=${order._id}`)).body.data[0];

    const reasonRequired = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/cancel`)
      .set(authHeader(admin))
      .send({})
      .expect(422);
    expect(reasonRequired.body.error.code).toBe('VALIDATION_ERROR');

    const cancelled = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/cancel`)
      .set(authHeader(admin))
      .send({ reason: 'Out of stock at supplier' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(cancelled.body.data.cancelledAt).toBeTruthy();

    const again = await request(app)
      .post(`${API}/admin/supplier-orders/${supplierOrder._id}/cancel`)
      .set(authHeader(admin))
      .send({ reason: 'Again' })
      .expect(200);
    expect(again.body.data.status).toBe('cancelled');
  });

  it('does not duplicate supplier orders when the same order is scheduled twice', async () => {
    const order = await placeCodOrder();
    const first = (await listSupplierOrders(`?orderId=${order._id}`)).body.data;
    expect(first).toHaveLength(1);

    await request(app)
      .post(`${API}/admin/supplier-orders/${first[0]._id}/retry`)
      .set(authHeader(admin))
      .expect(200);

    const second = (await listSupplierOrders(`?orderId=${order._id}`)).body.data;
    expect(second).toHaveLength(1);
    expect(second[0].idempotencyKey).toBe(first[0].idempotencyKey);
  });
});
