import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { PAYMENT_METHOD, PAYMENT_PROVIDER, PAYMENT_STATUS, REFUND_STATUS } from '../../constants/payment.js';
import { ORDER_STATUS } from '../../constants/orderStatus.js';
import { Payment } from '../../models/Payment.js';
import { Order } from '../../models/Order.js';
import { User } from '../../models/User.js';
import { WebhookEvent } from '../../models/WebhookEvent.js';
import { buildPaginationMeta, parsePagination } from '../../utils/http.js';
import { fromPaise, roundMoney, toPaise } from '../../utils/money.js';
import { randomToken } from '../../utils/crypto.js';
import { logger } from '../../config/logger.js';
import * as orderLifecycle from '../orders/orderLifecycle.service.js';
import { scheduleSupplierOrdersForOrder } from '../suppliers/supplierOrder.service.js';
import {
  buildMockCheckoutSignature,
  createGatewayOrder,
  createGatewayRefund,
  fetchGatewayPayment,
  getPaymentMode,
  getPaymentProvider,
  getPublicKeyId,
  isMockPaymentMode,
  isPaymentGatewayAvailable,
  verifyCheckoutSignature,
  verifyWebhookSignature
} from './payments.gateway.js';

export { isPaymentGatewayAvailable };

export const toPublicPayment = (payment) => {
  const json = payment.toJSON ? payment.toJSON() : { ...payment };
  delete json.providerResponse;
  delete json.providerSignature;
  delete json.idempotencyKey;
  delete json.user;
  return json;
};

const sumRefunds = (payment) =>
  roundMoney(
    (payment.refunds || [])
      .filter((refund) => refund.status !== REFUND_STATUS.FAILED)
      .reduce((sum, refund) => sum + refund.amount, 0)
  );

const buildCheckoutPayload = (order, payment, user) => ({
  provider: payment.provider,
  mode: getPaymentMode(),
  keyId: getPublicKeyId(),
  orderId: order._id,
  orderNumber: order.orderNumber,
  providerOrderId: payment.providerOrderId,
  amount: payment.amount,
  amountPaise: toPaise(payment.amount),
  currency: payment.currency,
  isMock: payment.isMock,
  checkout: {
    name: 'HIGHFLIER',
    description: `Order ${order.orderNumber}`,
    prefill: {
      name: user?.name || order.shippingAddress?.fullName || '',
      email: user?.email || '',
      contact: order.shippingAddress?.phone || ''
    },
    notes: { orderId: String(order._id), orderNumber: order.orderNumber }
  },
  ...(payment.isMock
    ? {
        mockInstructions:
          'Mock payment mode is enabled. No real money moves. Use POST /api/v1/payments/mock/pay or compute the signature with PAYMENT_MOCK_SECRET for /payments/verify.'
      }
    : {})
});

export const recordCodPayment = async (order) => {
  const existing = await Payment.findOne({ order: order._id, provider: PAYMENT_PROVIDER.COD });
  if (existing) return existing;
  return Payment.create({
    order: order._id,
    user: order.user,
    provider: PAYMENT_PROVIDER.COD,
    method: PAYMENT_METHOD.COD,
    amount: order.total,
    currency: 'INR',
    status: PAYMENT_STATUS.COD_PENDING,
    isMock: false
  });
};

export const createPaymentForOrder = async (userId, orderId, { requestId = '' } = {}) => {
  if (!isPaymentGatewayAvailable()) {
    throw new ApiError(503, ERROR_CODES.PAYMENT_NOT_CONFIGURED, 'Payment gateway is not configured');
  }

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw ApiError.notFound('Order');
  if (order.paymentMethod !== PAYMENT_METHOD.ONLINE) {
    throw ApiError.badRequest('This order uses cash on delivery and does not require an online payment');
  }
  if (order.paymentStatus === PAYMENT_STATUS.CAPTURED) {
    throw ApiError.conflict('This order has already been paid');
  }
  if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED].includes(order.status)) {
    throw ApiError.conflict('This order can no longer be paid');
  }

  if (order.total <= 0) {
    const { order: paidOrder } = await orderLifecycle.markOrderPaid(order._id, {
      providerPaymentId: 'free-order'
    });
    try {
      await scheduleSupplierOrdersForOrder(paidOrder);
    } catch (error) {
      logger.error({ err: error, orderId: String(order._id) }, 'Supplier scheduling after free order failed');
      await orderLifecycle.markFulfilmentIssue(order._id, 'Supplier order submission requires attention.');
    }
    return { free: true, provider: 'none', amount: 0, order: paidOrder };
  }

  const provider = getPaymentProvider();
  let payment = await Payment.findOne({
    order: order._id,
    provider,
    status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CREATED] }
  }).sort({ createdAt: -1 });

  if (!payment || !payment.providerOrderId || payment.amount !== order.total) {
    const gatewayOrder = await createGatewayOrder({
      amountPaise: toPaise(order.total),
      receipt: order.orderNumber,
      notes: { orderId: String(order._id), orderNumber: order.orderNumber, requestId }
    });

    payment = await Payment.create({
      order: order._id,
      user: userId,
      provider,
      method: PAYMENT_METHOD.ONLINE,
      providerOrderId: gatewayOrder.id,
      amount: order.total,
      currency: 'INR',
      status: PAYMENT_STATUS.CREATED,
      isMock: isMockPaymentMode(),
      providerResponse: { gatewayOrder: sanitizeGatewayResponse(gatewayOrder) }
    });
  }

  await Order.updateOne(
    { _id: order._id, paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CREATED] } },
    { $set: { paymentStatus: PAYMENT_STATUS.CREATED } }
  );

  const user = await User.findById(userId);
  return buildCheckoutPayload(order, payment, user);
};

const sanitizeGatewayResponse = (value) => {
  if (!value || typeof value !== 'object') return {};
  const clone = JSON.parse(JSON.stringify(value));
  delete clone.notes?.webhookSecret;
  return clone;
};

/**
 * Atomically captures a payment and confirms the order. Safe to call twice:
 * duplicate callbacks return the already-captured payment.
 */
const confirmCapturedPayment = async (payment, { providerPaymentId, signature = null, remote = null }) => {
  const now = new Date();
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: PAYMENT_STATUS.CAPTURED } },
    {
      $set: {
        status: PAYMENT_STATUS.CAPTURED,
        providerPaymentId,
        signatureVerified: true,
        verifiedAt: now,
        capturedAt: now,
        failedAt: null,
        failureReason: '',
        ...(signature ? { providerSignature: String(signature).slice(0, 300) } : {}),
        ...(remote ? { providerResponse: sanitizeGatewayResponse(remote) } : {})
      }
    },
    { new: true }
  );

  const captured = updated || (await Payment.findById(payment._id));
  if (!updated) {
    const order = await Order.findById(captured.order);
    return { payment: captured, order, replay: true };
  }

  const { order, refundRequired } = await orderLifecycle.markOrderPaid(captured.order, {
    providerPaymentId,
    paymentId: captured._id
  });

  if (refundRequired) {
    logger.error({ orderId: String(order._id), paymentId: String(captured._id) }, 'Payment captured for cancelled order');
  } else {
    try {
      await scheduleSupplierOrdersForOrder(order);
    } catch (error) {
      logger.error({ err: error, orderId: String(order._id) }, 'Supplier order scheduling after payment failed');
      await orderLifecycle.markFulfilmentIssue(
        order._id,
        'Payment received but supplier submission failed. Retry from admin supplier-orders.'
      );
    }
  }

  const freshOrder = await Order.findById(order._id);
  return { payment: captured, order: freshOrder, replay: false };
};

export const verifyPayment = async (userId, payload) => {
  const providerOrderId = payload.providerOrderId || payload.razorpay_order_id;
  const providerPaymentId = payload.providerPaymentId || payload.razorpay_payment_id;
  const signature = payload.signature || payload.razorpay_signature;

  if (!providerOrderId || !providerPaymentId || !signature) {
    throw ApiError.badRequest('provider order id, payment id and signature are required');
  }

  const payment = await Payment.findOne({ providerOrderId });
  if (!payment) throw ApiError.notFound('Payment');
  if (String(payment.user) !== String(userId)) throw ApiError.forbidden('This payment does not belong to you');

  if (payment.status === PAYMENT_STATUS.CAPTURED) {
    const order = await Order.findById(payment.order);
    return { payment: payment, order, replay: true };
  }
  if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED].includes((await Order.findById(payment.order))?.status)) {
    throw new ApiError(409, ERROR_CODES.INVALID_STATE_TRANSITION, 'This order is no longer payable');
  }

  if (!verifyCheckoutSignature({ providerOrderId, providerPaymentId, signature })) {
    await Payment.updateOne(
      { _id: payment._id, status: { $ne: PAYMENT_STATUS.CAPTURED } },
      { $set: { failureReason: 'Checkout signature verification failed', failedAt: new Date() } }
    );
    throw new ApiError(400, ERROR_CODES.SIGNATURE_INVALID, 'Payment signature verification failed');
  }

  let remote = null;
  if (getPaymentMode() === 'razorpay') {
    remote = await fetchGatewayPayment(providerPaymentId);
    if (remote?.order_id && remote.order_id !== providerOrderId) {
      throw new ApiError(400, ERROR_CODES.SIGNATURE_INVALID, 'Payment does not belong to this payment order');
    }
    if (Number(remote?.amount) !== toPaise(payment.amount)) {
      throw new ApiError(400, ERROR_CODES.PAYMENT_FAILED, 'Payment amount does not match the order amount');
    }
    if (!['captured', 'authorized'].includes(remote?.status)) {
      await Payment.updateOne(
        { _id: payment._id, status: { $ne: PAYMENT_STATUS.CAPTURED } },
        {
          $set: {
            status: PAYMENT_STATUS.FAILED,
            failureReason: `Gateway status: ${remote?.status || 'unknown'}`,
            failedAt: new Date()
          }
        }
      );
      await orderLifecycle.markPaymentFailed(payment.order, 'Payment was not successful');
      throw new ApiError(400, ERROR_CODES.PAYMENT_FAILED, 'Payment was not successful');
    }
    if (remote?.status === 'authorized') {
      logger.warn({ paymentId: providerPaymentId }, 'Gateway payment is authorized but not captured yet');
    }
  }

  return confirmCapturedPayment(payment, { providerPaymentId, signature, remote });
};

/**
 * Development-only helper: completes a mock payment without any external call.
 * Requires PAYMENTS_MOCK_MODE=true and never touches Razorpay.
 */
export const simulateMockPayment = async (userId, orderId, { outcome = 'success' } = {}) => {
  if (!isMockPaymentMode()) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'Mock payments are disabled');
  }

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw ApiError.notFound('Order');
  if (order.paymentMethod !== PAYMENT_METHOD.ONLINE) {
    throw ApiError.badRequest('Mock online payment is only available for online-payment orders');
  }

  let payment = await Payment.findOne({ order: order._id, provider: PAYMENT_PROVIDER.MOCK });
  if (!payment) {
    await createPaymentForOrder(userId, order._id);
    payment = await Payment.findOne({ order: order._id, provider: PAYMENT_PROVIDER.MOCK }).sort({ createdAt: -1 });
  }
  if (!payment) throw ApiError.notFound('Payment');
  if (payment.status === PAYMENT_STATUS.CAPTURED) {
    return { payment, order: await Order.findById(order._id), replay: true, mock: true };
  }

  if (outcome === 'failure') {
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failedAt = new Date();
    payment.failureReason = 'Simulated payment failure';
    await payment.save();
    await orderLifecycle.markPaymentFailed(order._id, 'Simulated payment failure');
    return { payment, order: await Order.findById(order._id), failed: true, mock: true };
  }

  const providerPaymentId = `pay_mock_${randomToken(8)}`;
  const signature = buildMockCheckoutSignature(payment.providerOrderId, providerPaymentId);
  const result = await confirmCapturedPayment(payment, {
    providerPaymentId,
    signature,
    remote: { mock: true, id: providerPaymentId, status: 'captured', method: 'upi' }
  });
  return { ...result, mock: true };
};

const findPaymentForWebhookEntity = async (entity) => {
  if (!entity) return null;
  if (entity.order_id) {
    const byOrder = await Payment.findOne({ providerOrderId: entity.order_id });
    if (byOrder) return byOrder;
  }
  if (entity.payment_id) {
    const byPayment = await Payment.findOne({ providerPaymentId: entity.payment_id });
    if (byPayment) return byPayment;
  }
  if (entity.id) {
    return Payment.findOne({ providerPaymentId: entity.id });
  }
  return null;
};

const recordRefundFromWebhook = async (payment, refundEntity) => {
  const refundId = refundEntity.id;
  if (!refundId) return 'ignored';

  const amount = fromPaise(refundEntity.amount || 0);
  const status =
    refundEntity.status === 'processed'
      ? REFUND_STATUS.PROCESSED
      : refundEntity.status === 'failed'
        ? REFUND_STATUS.FAILED
        : REFUND_STATUS.PENDING;

  const existing = (payment.refunds || []).find((refund) => refund.providerRefundId === refundId);
  if (existing) {
    if (existing.status !== status) {
      existing.status = status;
      if (status === REFUND_STATUS.PROCESSED) existing.processedAt = new Date();
      await Payment.updateOne(
        { _id: payment._id, 'refunds.providerRefundId': refundId },
        {
          $set: {
            'refunds.$.status': status,
            'refunds.$.processedAt': status === REFUND_STATUS.PROCESSED ? new Date() : null
          }
        }
      );
    }
    return 'processed';
  }

  const insertResult = await Payment.updateOne(
    { _id: payment._id, 'refunds.providerRefundId': { $ne: refundId } },
    {
      $push: {
        refunds: {
          providerRefundId: refundId,
          amount,
          status,
          reason: 'Gateway webhook refund',
          createdAt: new Date(),
          processedAt: status === REFUND_STATUS.PROCESSED ? new Date() : null
        }
      }
    }
  );
  if (insertResult.modifiedCount === 0) return 'processed';

  const fresh = await Payment.findById(payment._id);
  const totalRefunded = sumRefunds(fresh);
  const paymentStatus =
    totalRefunded >= fresh.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  await Payment.updateOne({ _id: fresh._id }, { $set: { status: paymentStatus } });

  const order = await Order.findById(payment.order);
  if (order) {
    const newRefunded = roundMoney(order.amountRefunded + amount);
    order.amountRefunded = newRefunded;
    order.paymentStatus = paymentStatus;
    if (newRefunded >= order.amountPaid && order.amountPaid > 0) {
      order.status = ORDER_STATUS.REFUNDED;
      order.statusHistory.push({
        status: ORDER_STATUS.REFUNDED,
        note: 'Refund processed via gateway webhook',
        actorType: 'system',
        at: new Date()
      });
    }
    await order.save();
  }

  return 'processed';
};

/**
 * Verifies and processes a signed webhook. Event ids are deduplicated through a
 * unique index; previously failed events are allowed to be retried.
 */
export const handleWebhook = async ({ rawBody, signature }) => {
  if (!rawBody || rawBody.length === 0) {
    throw new ApiError(400, ERROR_CODES.WEBHOOK_INVALID, 'Webhook body is required');
  }
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new ApiError(400, ERROR_CODES.WEBHOOK_INVALID, 'Webhook signature verification failed');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    throw new ApiError(400, ERROR_CODES.WEBHOOK_INVALID, 'Webhook body is not valid JSON');
  }

  const eventType = payload.event || payload.type || 'unknown';
  const entity =
    payload.payload?.payment?.entity ||
    payload.payload?.refund?.entity ||
    payload.payload?.order?.entity ||
    {};
  const eventId = String(payload.event_id || `${eventType}:${entity.id || randomToken(6)}`).slice(0, 160);
  const provider = isMockPaymentMode() ? 'mock' : 'razorpay';

  let webhookEvent = await WebhookEvent.findOne({ provider, eventId });
  if (webhookEvent && ['processed', 'ignored'].includes(webhookEvent.status)) {
    return { received: true, duplicate: true, status: webhookEvent.status, eventType };
  }
  if (!webhookEvent) {
    try {
      webhookEvent = await WebhookEvent.create({
        provider,
        eventId,
        eventType,
        signatureVerified: true,
        payload,
        status: 'received'
      });
    } catch (error) {
      if (error?.code === 11000) {
        return { received: true, duplicate: true, status: 'duplicate', eventType };
      }
      throw error;
    }
  }

  try {
    let result = 'ignored';

    if (eventType === 'payment.captured' || eventType === 'payment.authorized') {
      if (eventType === 'payment.captured') {
        const payment = await findPaymentForWebhookEntity(entity);
        if (payment) {
          if (payment.status === PAYMENT_STATUS.CAPTURED) {
            result = 'processed';
          } else {
            await confirmCapturedPayment(payment, { providerPaymentId: entity.id, remote: entity });
            result = 'processed';
          }
        }
      }
    } else if (eventType === 'payment.failed') {
      const payment = await findPaymentForWebhookEntity(entity);
      if (payment && payment.status !== PAYMENT_STATUS.CAPTURED) {
        await Payment.updateOne(
          { _id: payment._id, status: { $ne: PAYMENT_STATUS.CAPTURED } },
          {
            $set: {
              status: PAYMENT_STATUS.FAILED,
              failureReason: String(entity.error_description || 'Payment failed').slice(0, 500),
              failedAt: new Date()
            }
          }
        );
        await orderLifecycle.markPaymentFailed(payment.order, 'Payment failed at the gateway');
        result = 'processed';
      }
    } else if (eventType === 'refund.processed' || eventType === 'refund.created') {
      const payment = await findPaymentForWebhookEntity(entity);
      if (payment) result = await recordRefundFromWebhook(payment, entity);
    }

    webhookEvent.status = result;
    webhookEvent.processedAt = new Date();
    await webhookEvent.save();
    return { received: true, duplicate: false, status: result, eventType };
  } catch (error) {
    webhookEvent.status = 'failed';
    webhookEvent.error = String(error.message || 'Webhook processing failed').slice(0, 1000);
    await webhookEvent.save();
    throw error;
  }
};

/**
 * Refunds a captured payment. Mock mode returns a clearly labelled mock refund;
 * COD refunds are recorded manually because no online payment was captured.
 */
export const refundPaymentForOrder = async (order, { amount, reason, initiatedBy = null }) => {
  const orderDoc = order.toObject ? order : await Order.findById(order._id || order);
  if (!orderDoc) throw ApiError.notFound('Order');

  const remaining = roundMoney(orderDoc.amountPaid - orderDoc.amountRefunded);
  if (remaining <= 0) throw ApiError.conflict('This order has no refundable amount');
  const refundAmount = roundMoney(Math.min(Number(amount), remaining));
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    throw ApiError.badRequest('Refund amount must be greater than zero');
  }

  if (orderDoc.paymentMethod === PAYMENT_METHOD.COD) {
    const now = new Date();
    const refund = {
      providerRefundId: `cod-manual-${randomToken(6)}`,
      amount: refundAmount,
      status: REFUND_STATUS.PROCESSED,
      reason: String(reason || '').slice(0, 500),
      initiatedBy,
      createdAt: now,
      processedAt: now
    };
    let codPayment = await Payment.findOne({ order: orderDoc._id, provider: PAYMENT_PROVIDER.COD });
    if (!codPayment) {
      codPayment = new Payment({
        order: orderDoc._id,
        user: orderDoc.user,
        provider: PAYMENT_PROVIDER.COD,
        method: PAYMENT_METHOD.COD,
        amount: orderDoc.amountPaid,
        status: PAYMENT_STATUS.CAPTURED,
        isMock: false
      });
    }
    codPayment.refunds.push(refund);
    const totalRefunded = sumRefunds(codPayment);
    codPayment.status = totalRefunded >= codPayment.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
    if (codPayment.status === PAYMENT_STATUS.REFUNDED) codPayment.refunds[codPayment.refunds.length - 1].processedAt = now;
    await codPayment.save();
    await Order.updateOne(
      { _id: orderDoc._id },
      {
        $inc: { amountRefunded: refundAmount },
        $set: { paymentStatus: codPayment.status }
      }
    );
    return {
      refundId: refund.providerRefundId,
      amount: refundAmount,
      status: 'processed',
      manual: true,
      mock: false
    };
  }

  const payment = await Payment.findOne({
    order: orderDoc._id,
    status: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED] }
  }).sort({ createdAt: -1 });
  if (!payment) {
    throw new ApiError(409, ERROR_CODES.INVALID_STATE_TRANSITION, 'No captured online payment exists for this order');
  }
  if (!payment.providerPaymentId) {
    throw ApiError.conflict('The captured payment has no gateway payment reference');
  }

  const alreadyRefunded = sumRefunds(payment);
  const refundable = roundMoney(payment.amount - alreadyRefunded);
  if (refundAmount > refundable) {
    throw ApiError.badRequest(`Refund exceeds the refundable amount (₹${refundable})`);
  }

  const gatewayRefund = await createGatewayRefund({
    providerPaymentId: payment.providerPaymentId,
    amountPaise: toPaise(refundAmount),
    notes: { orderNumber: orderDoc.orderNumber, reason: String(reason || '').slice(0, 200) }
  });

  const now = new Date();
  const refundStatus =
    gatewayRefund.status === 'processed'
      ? REFUND_STATUS.PROCESSED
      : gatewayRefund.status === 'failed'
        ? REFUND_STATUS.FAILED
        : REFUND_STATUS.PENDING;

  const inserted = await Payment.updateOne(
    { _id: payment._id, 'refunds.providerRefundId': { $ne: gatewayRefund.id } },
    {
      $push: {
        refunds: {
          providerRefundId: gatewayRefund.id,
          amount: refundAmount,
          status: refundStatus,
          reason: String(reason || '').slice(0, 500),
          initiatedBy,
          createdAt: now,
          processedAt: refundStatus === REFUND_STATUS.PROCESSED ? now : null
        }
      }
    }
  );
  if (inserted.modifiedCount === 0) {
    return {
      refundId: gatewayRefund.id,
      amount: refundAmount,
      status: 'already_recorded',
      manual: false,
      mock: Boolean(gatewayRefund.mock)
    };
  }

  const fresh = await Payment.findById(payment._id);
  const totalRefunded = sumRefunds(fresh);
  const paymentStatus =
    totalRefunded >= fresh.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  await Payment.updateOne({ _id: fresh._id }, { $set: { status: paymentStatus } });
  await Order.updateOne(
    { _id: orderDoc._id },
    { $inc: { amountRefunded: refundAmount }, $set: { paymentStatus } }
  );

  return {
    refundId: gatewayRefund.id,
    amount: refundAmount,
    status: refundStatus,
    manual: false,
    mock: Boolean(gatewayRefund.mock)
  };
};

export const getPaymentsForOrder = async (userId, orderId) => {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw ApiError.notFound('Order');
  const payments = await Payment.find({ order: order._id }).sort({ createdAt: -1 });
  return payments.map(toPublicPayment);
};

export const listPaymentsAdmin = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.provider) filter.provider = query.provider;
  if (query.orderId) filter.order = query.orderId;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'order', select: 'orderNumber status total user' })
      .populate({ path: 'user', select: 'name email' }),
    Payment.countDocuments(filter)
  ]);

  return {
    payments: payments.map((payment) => {
      const json = payment.toJSON();
      delete json.providerSignature;
      return json;
    }),
    meta: buildPaginationMeta({ page, limit, total })
  };
};

export const getPaymentConfig = () => ({
  mode: getPaymentMode(),
  provider: getPaymentMode() === 'none' ? null : getPaymentProvider(),
  keyId: getPublicKeyId(),
  mock: isMockPaymentMode(),
  configured: isPaymentGatewayAvailable()
});
