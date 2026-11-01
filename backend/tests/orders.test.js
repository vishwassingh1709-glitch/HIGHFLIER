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
  createDeliveredOrder,
  orderItem
} from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { MOCK_SUPPLIER_CAPABILITIES } from '../src/modules/suppliers/adapters/mockAdapter.js';
import { buildMockCheckoutSignature } from '../src/modules/payments/payments.gateway.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';

const SLOW_TIMELINE = { mockTimelineSeconds: { processing: 3600, shipped: 7200, delivered: 10800 } };

describe('checkout, orders, cancellation and returns', () => {
  let admin;
  let user;
  let otherUser;
  let supplier;
  let product;
  let address;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    user = await createUser();
    otherUser = await createUser();
    address = await addAddress(user);
    supplier = await createMockSupplier({ config: SLOW_TIMELINE });
    product = await createProduct({ supplier });
  });

  const addToCart = async (quantity = 2, target = product) =>
    request(app)
      .post(`${API}/cart`)
      .set(authHeader(user))
      .send({ productId: target._id.toString(), sku: target.variants[0].sku, quantity })
      .expect(201);

  const checkout = (body) =>
    request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .send(body);

  const codCheckout = (extra = {}) =>
    checkout({
      paymentMethod: 'cod',
      addressId: address._id.toString(),
      items: [orderItem(product, null, 1)],
      ...extra
    });

  it('requires authentication', async () => {
    await request(app).get(`${API}/orders`).expect(401);
    await request(app)
      .post(`${API}/orders/checkout`)
      .send({ paymentMethod: 'cod' })
      .expect(401);
  });

  it('places a COD order from the cart, commits stock and clears the cart', async () => {
    await addToCart(2);

    const response = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .send({ paymentMethod: 'cod', addressId: address._id.toString() })
      .expect(201);

    const { order, payment, replay } = response.body.data;
    expect(replay).toBe(false);
    expect(payment).toBeNull();
    expect(order.paymentMethod).toBe('cod');
    expect(order.paymentStatus).toBe('cod_pending');
    expect(order.subtotal).toBe(300);
    expect(order.shippingFee).toBe(49);
    expect(order.total).toBe(349);
    expect(order.status).toBe('processing');
    expect(order.items[0].supplierCost).toBeUndefined();
    expect(order.items[0].supplierProductId).toBeUndefined();
    expect(order.shippingAddress.pincode).toBe('560001');

    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(18);
    expect(storedProduct.variants[0].reserved).toBe(0);

    const cart = await request(app).get(`${API}/cart`).set(authHeader(user)).expect(200);
    expect(cart.body.data.items).toHaveLength(0);
  });

  it('treats a repeated idempotency key as the same order', async () => {
    const payload = {
      paymentMethod: 'cod',
      addressId: address._id.toString(),
      items: [orderItem(product, null, 1)]
    };

    const first = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .set('Idempotency-Key', 'checkout-key-1')
      .send(payload)
      .expect(201);
    const second = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .set('Idempotency-Key', 'checkout-key-1')
      .send(payload)
      .expect(201);

    expect(second.body.data.replay).toBe(true);
    expect(second.body.data.order._id).toBe(first.body.data.order._id);

    const count = await Order.countDocuments({ user: user._id });
    expect(count).toBe(1);
    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(19);
  });

  it('rejects checkout without stock, without an address and for COD-blocked suppliers', async () => {
    const scarce = await createProduct({ supplier });
    scarce.variants[0].stock = 1;
    scarce.stock = 1;
    await scarce.save();

    const insufficient = await checkout({
      paymentMethod: 'cod',
      addressId: address._id.toString(),
      items: [orderItem(scarce, null, 2)]
    }).expect(409);
    expect(insufficient.body.error.code).toBe('INSUFFICIENT_STOCK');

    const noAddressUser = await createUser();
    const noAddress = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(noAddressUser))
      .send({ paymentMethod: 'cod', items: [orderItem(product, null, 1)] })
      .expect(400);
    expect(noAddress.body.error.message).toMatch(/address/i);

    const codBlockedSupplier = await createMockSupplier({
      config: SLOW_TIMELINE,
      capabilities: { ...MOCK_SUPPLIER_CAPABILITIES, cod: false }
    });
    const codBlockedProduct = await createProduct({ supplier: codBlockedSupplier });
    const blocked = await checkout({
      paymentMethod: 'cod',
      addressId: address._id.toString(),
      items: [orderItem(codBlockedProduct, null, 1)]
    }).expect(400);
    expect(blocked.body.error.message).toMatch(/cash on delivery/i);

    const emptyCart = await checkout({ paymentMethod: 'cod', addressId: address._id.toString() }).expect(400);
    expect(emptyCart.body.error.message).toMatch(/cart is empty/i);
  });

  it('runs the mock online payment flow end to end with signature verification', async () => {
    const created = await checkout({
      paymentMethod: 'online',
      addressId: address._id.toString(),
      items: [orderItem(product, null, 1)]
    }).expect(201);

    const { order, payment } = created.body.data;
    expect(order.status).toBe('pending_payment');
    expect(payment.isMock).toBe(true);
    expect(payment.providerOrderId).toMatch(/^order_mock_/);

    const providerPaymentId = 'pay_mock_test_001';
    const wrong = await request(app)
      .post(`${API}/payments/verify`)
      .set(authHeader(user))
      .send({ providerOrderId: payment.providerOrderId, providerPaymentId, signature: 'not-valid' })
      .expect(400);
    expect(wrong.body.error.code).toBe('SIGNATURE_INVALID');

    const signature = buildMockCheckoutSignature(payment.providerOrderId, providerPaymentId);
    const verified = await request(app)
      .post(`${API}/payments/verify`)
      .set(authHeader(user))
      .send({ providerOrderId: payment.providerOrderId, providerPaymentId, signature })
      .expect(200);

    expect(verified.body.data.payment.status).toBe('captured');
    expect(verified.body.data.order.paymentStatus).toBe('captured');
    expect(verified.body.data.order.status).toBe('processing');

    const replay = await request(app)
      .post(`${API}/payments/verify`)
      .set(authHeader(user))
      .send({ providerOrderId: payment.providerOrderId, providerPaymentId, signature })
      .expect(200);
    expect(replay.body.data.replay).toBe(true);

    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(19);
  });

  it('scopes orders to their owner and lists them with filters', async () => {
    const created = await codCheckout();
    const orderId = created.body.data.order._id;
    const orderNumber = created.body.data.order.orderNumber;

    const own = await request(app)
      .get(`${API}/orders/${orderNumber}`)
      .set(authHeader(user))
      .expect(200);
    expect(own.body.data.orderNumber).toBe(orderNumber);

    await request(app)
      .get(`${API}/orders/${orderId}`)
      .set(authHeader(otherUser))
      .expect(404);

    const listed = await request(app)
      .get(`${API}/orders?status=processing`)
      .set(authHeader(user))
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.meta.total).toBe(1);

    const otherListed = await request(app).get(`${API}/orders`).set(authHeader(otherUser)).expect(200);
    expect(otherListed.body.data).toHaveLength(0);
  });

  it('cancels a COD order and restores committed stock', async () => {
    const created = await codCheckout();
    const orderId = created.body.data.order._id;

    const missingReason = await request(app)
      .post(`${API}/orders/${orderId}/cancel`)
      .set(authHeader(user))
      .send({})
      .expect(422);
    expect(missingReason.body.error.code).toBe('VALIDATION_ERROR');

    const cancelled = await request(app)
      .post(`${API}/orders/${orderId}/cancel`)
      .set(authHeader(user))
      .send({ reason: 'Changed my mind' })
      .expect(200);

    expect(cancelled.body.data.order.status).toBe('cancelled');
    expect(cancelled.body.data.refund).toBeNull();

    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(20);

    const again = await request(app)
      .post(`${API}/orders/${orderId}/cancel`)
      .set(authHeader(user))
      .send({ reason: 'Again' })
      .expect(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('refunds a captured online payment when the customer cancels', async () => {
    const created = await checkout({
      paymentMethod: 'online',
      addressId: address._id.toString(),
      items: [orderItem(product, null, 1)]
    }).expect(201);
    const { order, payment } = created.body.data;
    const providerPaymentId = 'pay_mock_refund_001';
    await request(app)
      .post(`${API}/payments/verify`)
      .set(authHeader(user))
      .send({
        providerOrderId: payment.providerOrderId,
        providerPaymentId,
        signature: buildMockCheckoutSignature(payment.providerOrderId, providerPaymentId)
      })
      .expect(200);

    const cancelled = await request(app)
      .post(`${API}/orders/${order._id}/cancel`)
      .set(authHeader(user))
      .send({ reason: 'Found a better price' })
      .expect(200);

    expect(cancelled.body.data.order.status).toBe('cancelled');
    expect(cancelled.body.data.refund.mock).toBe(true);
    expect(cancelled.body.data.refund.status).toBe('processed');
    expect(cancelled.body.data.order.paymentStatus).toBe('refunded');
    expect(cancelled.body.data.order.amountRefunded).toBe(order.total);

    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(20);
  });

  it('accepts, rejects and validates return requests', async () => {
    const delivered = await createDeliveredOrder({ user, product, supplier });
    const duplicateBefore = await request(app)
      .post(`${API}/orders/${delivered._id}/return`)
      .set(authHeader(user))
      .send({ reason: 'Item defective' })
      .expect(200);
    expect(duplicateBefore.body.data.status).toBe('return_requested');

    const duplicate = await request(app)
      .post(`${API}/orders/${delivered._id}/return`)
      .set(authHeader(user))
      .send({ reason: 'Again' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const approved = await request(app)
      .post(`${API}/admin/orders/${delivered._id}/return-decision`)
      .set(authHeader(admin))
      .send({ decision: 'approve', note: 'Approved after inspection' })
      .expect(200);
    expect(approved.body.data.status).toBe('returned');
    expect(approved.body.data.returnRequest.status).toBe('completed');

    const rejectionOrder = await createDeliveredOrder({ user, product, supplier });
    await request(app)
      .post(`${API}/orders/${rejectionOrder._id}/return`)
      .set(authHeader(user))
      .send({ reason: 'Changed mind' })
      .expect(200);
    const rejected = await request(app)
      .post(`${API}/admin/orders/${rejectionOrder._id}/return-decision`)
      .set(authHeader(admin))
      .send({ decision: 'reject', note: 'Outside policy' })
      .expect(200);
    expect(rejected.body.data.status).toBe('delivered');
    expect(rejected.body.data.returnRequest.status).toBe('rejected');

    const undelivered = await codCheckout();
    const notDelivered = await request(app)
      .post(`${API}/orders/${undelivered.body.data.order._id}/return`)
      .set(authHeader(user))
      .send({ reason: 'Too early' })
      .expect(409);
    expect(notDelivered.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('enforces the return window', async () => {
    const order = await createDeliveredOrder({ user, product, supplier });
    order.deliveredAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await order.save();

    const response = await request(app)
      .post(`${API}/orders/${order._id}/return`)
      .set(authHeader(user))
      .send({ reason: 'Late return' })
      .expect(400);
    expect(response.body.error.message).toMatch(/return window/i);
  });

  it('lets admins drive status, tracking and notes with guarded transitions', async () => {
    const created = await codCheckout();
    const orderId = created.body.data.order._id;

    const shipped = await request(app)
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(authHeader(admin))
      .send({ status: 'shipped', note: 'Handed to courier' })
      .expect(200);
    expect(shipped.body.data.status).toBe('shipped');

    const tracking = await request(app)
      .patch(`${API}/admin/orders/${orderId}/tracking`)
      .set(authHeader(admin))
      .send({ courier: 'BlueDart', trackingNumber: 'BD123', trackingUrl: 'https://track.example.com/BD123' })
      .expect(200);
    expect(tracking.body.data.tracking.courier).toBe('BlueDart');
    expect(tracking.body.data.tracking.isMock).toBe(false);

    await request(app)
      .patch(`${API}/admin/orders/${orderId}/tracking`)
      .set(authHeader(admin))
      .send({ trackingUrl: 'javascript:alert(1)' })
      .expect(422);

    const delivered = await request(app)
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(authHeader(admin))
      .send({ status: 'delivered' })
      .expect(200);
    expect(delivered.body.data.status).toBe('delivered');
    expect(delivered.body.data.paymentStatus).toBe('captured');
    expect(delivered.body.data.amountPaid).toBe(delivered.body.data.total);

    const invalid = await request(app)
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(authHeader(admin))
      .send({ status: 'processing' })
      .expect(409);
    expect(invalid.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const note = await request(app)
      .patch(`${API}/admin/orders/${orderId}/note`)
      .set(authHeader(admin))
      .send({ adminNote: 'Customer called about delivery' })
      .expect(200);
    expect(note.body.data.adminNote).toMatch(/Customer called/);

    const listed = await request(app)
      .get(`${API}/admin/orders?q=${encodeURIComponent(created.body.data.order.orderNumber)}`)
      .set(authHeader(admin))
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].user.email).toBe(user.email);

    await request(app)
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(authHeader(user))
      .send({ status: 'shipped' })
      .expect(403);
  });
});
