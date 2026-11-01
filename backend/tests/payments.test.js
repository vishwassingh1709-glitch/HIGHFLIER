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
import { buildMockWebhookSignature } from '../src/modules/payments/payments.gateway.js';
import { Payment } from '../src/models/Payment.js';
import { Product } from '../src/models/Product.js';

const SLOW_TIMELINE = { mockTimelineSeconds: { processing: 3600, shipped: 7200, delivered: 10800 } };

describe('payments, webhooks and refunds', () => {
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

  const createOnlineOrder = async (quantity = 1) => {
    const response = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .send({
        paymentMethod: 'online',
        addressId: address._id.toString(),
        items: [orderItem(product, null, quantity)]
      })
      .expect(201);
    return response.body.data;
  };

  const createCodOrder = async () => {
    const response = await request(app)
      .post(`${API}/orders/checkout`)
      .set(authHeader(user))
      .send({
        paymentMethod: 'cod',
        addressId: address._id.toString(),
        items: [orderItem(product, null, 1)]
      })
      .expect(201);
    return response.body.data.order;
  };

  const sendWebhook = async (payload, { signature } = {}) => {
    const raw = JSON.stringify(payload);
    return request(app)
      .post(`${API}/payments/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature ?? buildMockWebhookSignature(raw))
      .send(raw);
  };

  it('reports clearly labelled mock payment configuration', async () => {
    const response = await request(app)
      .get(`${API}/payments/config`)
      .set(authHeader(user))
      .expect(200);
    expect(response.body.data).toMatchObject({
      mode: 'mock',
      provider: 'mock',
      mock: true,
      configured: true,
      keyId: 'rzp_test_highflier_mock'
    });
    await request(app).get(`${API}/payments/config`).expect(401);
  });

  it('creates a payment order for an online order', async () => {
    const { order, payment } = await createOnlineOrder();
    const response = await request(app)
      .post(`${API}/payments/orders/${order._id}`)
      .set(authHeader(user))
      .expect(200);

    expect(response.body.data.mode).toBe('mock');
    expect(response.body.data.isMock).toBe(true);
    expect(response.body.data.providerOrderId).toBe(payment.providerOrderId);
    expect(response.body.data.amountPaise).toBe(Math.round(order.total * 100));
    expect(response.body.data.mockInstructions).toMatch(/No real money/i);
  });

  it('completes a mock payment and blocks replay from other users', async () => {
    const { order, payment } = await createOnlineOrder();

    const success = await request(app)
      .post(`${API}/payments/mock/pay`)
      .set(authHeader(user))
      .send({ orderId: order._id, outcome: 'success' })
      .expect(200);
    expect(success.body.data.mock).toBe(true);
    expect(success.body.data.payment.status).toBe('captured');
    expect(success.body.data.order.paymentStatus).toBe('captured');
    expect(success.body.data.order.status).toBe('processing');

    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(19);

    const otherUser = await createUser();
    const forbidden = await request(app)
      .post(`${API}/payments/verify`)
      .set(authHeader(otherUser))
      .send({
        providerOrderId: payment.providerOrderId,
        providerPaymentId: 'pay_other_user',
        signature: 'irrelevant'
      })
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('fails a mock payment, cancels the order and releases the reservation', async () => {
    const { order } = await createOnlineOrder();

    const failed = await request(app)
      .post(`${API}/payments/mock/pay`)
      .set(authHeader(user))
      .send({ orderId: order._id, outcome: 'failure' })
      .expect(200);
    expect(failed.body.data.failed).toBe(true);
    expect(failed.body.data.payment.status).toBe('failed');
    expect(failed.body.data.order.status).toBe('cancelled');
    expect(failed.body.data.order.paymentStatus).toBe('failed');

    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(20);
    expect(storedProduct.variants[0].reserved).toBe(0);
  });

  it('rejects unsigned or invalid webhooks', async () => {
    const response = await sendWebhook(
      { event_id: 'evt_bad', event: 'payment.captured', payload: {} },
      { signature: 'deadbeef' }
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('WEBHOOK_INVALID');
  });

  it('processes a signed payment.captured webhook idempotently', async () => {
    const { order, payment } = await createOnlineOrder();

    const payload = {
      event_id: 'evt_captured_1',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_captured_1',
            order_id: payment.providerOrderId,
            amount: payment.amountPaise,
            status: 'captured'
          }
        }
      }
    };

    const first = await sendWebhook(payload);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ received: true, duplicate: false, status: 'processed' });

    const duplicate = await sendWebhook(payload);
    expect(duplicate.body.data.duplicate).toBe(true);

    const orderResponse = await request(app)
      .get(`${API}/orders/${order._id}`)
      .set(authHeader(user))
      .expect(200);
    expect(orderResponse.body.data.paymentStatus).toBe('captured');
    expect(orderResponse.body.data.status).toBe('processing');
    expect(orderResponse.body.data.amountPaid).toBe(order.total);

    const storedProduct = await Product.findById(product._id);
    expect(storedProduct.variants[0].stock).toBe(19);
  });

  it('cancels unpaid orders when a payment.failed webhook arrives', async () => {
    const { order, payment } = await createOnlineOrder();

    const response = await sendWebhook({
      event_id: 'evt_failed_1',
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_failed_1',
            order_id: payment.providerOrderId,
            amount: payment.amountPaise,
            status: 'failed',
            error_description: 'Insufficient funds'
          }
        }
      }
    });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('processed');

    const orderResponse = await request(app)
      .get(`${API}/orders/${order._id}`)
      .set(authHeader(user))
      .expect(200);
    expect(orderResponse.body.data.status).toBe('cancelled');
    expect(orderResponse.body.data.paymentStatus).toBe('failed');

    const stored = await Payment.findOne({ order: order._id });
    expect(stored.status).toBe('failed');
    expect(stored.failureReason).toMatch(/Insufficient funds/);
  });

  it('records gateway refunds through a signed webhook', async () => {
    const { order } = await createOnlineOrder();
    const paid = await request(app)
      .post(`${API}/payments/mock/pay`)
      .set(authHeader(user))
      .send({ orderId: order._id })
      .expect(200);
    const providerPaymentId = paid.body.data.payment.providerPaymentId;

    const response = await sendWebhook({
      event_id: 'evt_refund_1',
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_webhook_1',
            payment_id: providerPaymentId,
            amount: Math.round(order.total * 100),
            status: 'processed'
          }
        }
      }
    });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('processed');

    const orderResponse = await request(app)
      .get(`${API}/orders/${order._id}`)
      .set(authHeader(user))
      .expect(200);
    expect(orderResponse.body.data.amountRefunded).toBe(order.total);
    expect(orderResponse.body.data.paymentStatus).toBe('refunded');
    expect(orderResponse.body.data.status).toBe('refunded');
  });

  it('lets admins list payments and process partial and full refunds', async () => {
    const { order } = await createOnlineOrder();
    await request(app)
      .post(`${API}/payments/mock/pay`)
      .set(authHeader(user))
      .send({ orderId: order._id })
      .expect(200);

    const listed = await request(app)
      .get(`${API}/admin/payments?provider=mock`)
      .set(authHeader(admin))
      .expect(200);
    expect(listed.body.data.length).toBeGreaterThanOrEqual(1);
    expect(listed.body.data[0].providerSignature).toBeUndefined();
    expect(listed.body.meta.total).toBeGreaterThanOrEqual(1);

    const partial = await request(app)
      .post(`${API}/admin/orders/${order._id}/refund`)
      .set(authHeader(admin))
      .send({ amount: 50, reason: 'Partial goodwill refund' })
      .expect(200);
    expect(partial.body.data.refund.amount).toBe(50);
    expect(partial.body.data.refund.manual).toBe(false);
    expect(partial.body.data.fullyRefunded).toBe(false);
    expect(partial.body.data.order.paymentStatus).toBe('partially_refunded');

    const remainder = await request(app)
      .post(`${API}/admin/orders/${order._id}/refund`)
      .set(authHeader(admin))
      .send({ reason: 'Refund the rest' })
      .expect(200);
    expect(remainder.body.data.fullyRefunded).toBe(true);
    expect(remainder.body.data.order.status).toBe('refunded');
    expect(remainder.body.data.order.amountRefunded).toBe(order.total);

    await request(app)
      .get(`${API}/admin/payments`)
      .set(authHeader(user))
      .expect(403);

    const pending = await createOnlineOrder();
    const invalid = await request(app)
      .post(`${API}/admin/orders/${pending.order._id}/refund`)
      .set(authHeader(admin))
      .send({ reason: 'No payment yet' })
      .expect(409);
    expect(invalid.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('records a manual COD refund after delivery and optionally restocks', async () => {
    const order = await createCodOrder();

    for (const status of ['shipped', 'delivered']) {
      await request(app)
        .patch(`${API}/admin/orders/${order._id}/status`)
        .set(authHeader(admin))
        .send({ status })
        .expect(200);
    }

    const beforeRefund = await Product.findById(product._id);
    expect(beforeRefund.variants[0].stock).toBe(19);

    const refunded = await request(app)
      .post(`${API}/admin/orders/${order._id}/refund`)
      .set(authHeader(admin))
      .send({ reason: 'Damaged on arrival', restock: true })
      .expect(200);

    expect(refunded.body.data.refund.manual).toBe(true);
    expect(refunded.body.data.refund.mock).toBe(false);
    expect(refunded.body.data.order.paymentStatus).toBe('refunded');
    expect(refunded.body.data.order.status).toBe('refunded');

    const afterRefund = await Product.findById(product._id);
    expect(afterRefund.variants[0].stock).toBe(20);
  });
});
