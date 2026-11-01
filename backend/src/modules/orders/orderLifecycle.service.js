import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { ORDER_STATUS, canTransitionOrderStatus } from '../../constants/orderStatus.js';
import { PAYMENT_STATUS } from '../../constants/payment.js';
import { Order } from '../../models/Order.js';
import { User } from '../../models/User.js';
import { Payment } from '../../models/Payment.js';
import {
  commitVariantStock,
  releaseVariantStock,
  restockVariant,
  recordInventoryTransaction
} from '../inventory/inventory.service.js';
import { sendOrderConfirmationEmail } from '../auth/mailer.service.js';
import { logger } from '../../config/logger.js';

const pushHistory = (order, status, { note = '', actorType = 'system', actor = null } = {}) => {
  order.statusHistory.push({ status, note, actorType, actor, at: new Date() });
};

const setStatus = (order, status, { note = '', actorType = 'system', actor = null, force = false } = {}) => {
  if (order.status === status) return false;
  if (!force && !canTransitionOrderStatus(order.status, status)) return false;
  order.status = status;
  pushHistory(order, status, { note, actorType, actor });
  return true;
};

const commitReservedItems = async (order) => {
  if (order.stockCommitted) return order;
  const committed = [];

  try {
    for (const item of order.items) {
      const updated = await commitVariantStock(item.product, item.variantSku, item.quantity);
      if (!updated) {
        throw new ApiError(
          409,
          ERROR_CODES.INSUFFICIENT_STOCK,
          `Stock reservation for "${item.title}" (${item.variantSku}) is no longer valid`
        );
      }
      committed.push(item);
      const variant = updated.variants.find((entry) => entry.sku === item.variantSku);
      await recordInventoryTransaction({
        productId: item.product,
        sku: item.variantSku,
        type: 'commit',
        quantity: -item.quantity,
        previousStock: (variant?.stock || 0) + item.quantity,
        newStock: variant?.stock || 0,
        reference: { kind: 'order', id: order._id },
        note: `Stock committed for order ${order.orderNumber}`
      });
    }
  } catch (error) {
    for (const item of committed) {
      await restockVariant({
        productId: item.product,
        sku: item.variantSku,
        quantity: item.quantity,
        reference: { kind: 'order', id: order._id },
        note: `Rollback after failed stock commit for ${order.orderNumber}`
      });
    }
    throw error;
  }

  order.stockCommitted = true;
  order.stockReserved = false;
  return order;
};

export const releaseReservations = async (order) => {
  if (!order.stockReserved || order.stockCommitted) return order;
  for (const item of order.items) {
    await releaseVariantStock(item.product, item.variantSku, item.quantity);
  }
  order.stockReserved = false;
  return order;
};

/**
 * Marks an order paid after a server-verified payment (or a valid COD
 * confirmation) and commits its reserved stock.
 */
export const markOrderPaid = async (orderId, { providerPaymentId = '', paymentId = null } = {}) => {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order');

  if (order.paymentStatus === PAYMENT_STATUS.CAPTURED && order.stockCommitted) {
    return { order, alreadyProcessed: true };
  }

  if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED].includes(order.status)) {
    order.paymentStatus = PAYMENT_STATUS.CAPTURED;
    order.amountPaid = order.total;
    order.fulfilmentIssue = {
      required: true,
      message: 'Payment was captured for an order that is no longer active. A refund is required.',
      at: new Date()
    };
    await order.save();
    return { order, alreadyProcessed: false, refundRequired: true };
  }

  order.paymentStatus = PAYMENT_STATUS.CAPTURED;
  order.amountPaid = order.total;
  order.paidAt = order.paidAt || new Date();
  order.paymentReference = providerPaymentId || order.paymentReference;

  await commitReservedItems(order);

  if (order.status === ORDER_STATUS.PENDING_PAYMENT) {
    if (!setStatus(order, ORDER_STATUS.CONFIRMED, {
      note: providerPaymentId ? `Payment verified (${providerPaymentId})` : 'Payment verified',
      actorType: 'system'
    })) {
      order.status = ORDER_STATUS.CONFIRMED;
      pushHistory(order, ORDER_STATUS.CONFIRMED, {
        note: providerPaymentId ? `Payment verified (${providerPaymentId})` : 'Payment verified'
      });
    }
  }
  order.confirmedAt = order.confirmedAt || new Date();
  await order.save();

  try {
    const user = await User.findById(order.user);
    if (user) await sendOrderConfirmationEmail(user, order);
  } catch (error) {
    logger.warn({ err: error, orderId: String(order._id) }, 'Order confirmation email failed');
  }

  return { order, alreadyProcessed: false };
};

/**
 * Confirms a Cash-on-Delivery order. COD is only reachable when every supplier
 * in the order advertises COD support, which checkout enforces.
 */
export const confirmCodOrder = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order');
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT) return { order, alreadyProcessed: true };

  await commitReservedItems(order);
  order.confirmedAt = new Date();
  setStatus(order, ORDER_STATUS.CONFIRMED, {
    note: 'Cash on delivery order confirmed',
    actorType: 'system',
    force: true
  });
  await order.save();

  try {
    const user = await User.findById(order.user);
    if (user) await sendOrderConfirmationEmail(user, order);
  } catch (error) {
    logger.warn({ err: error, orderId: String(order._id) }, 'COD confirmation email failed');
  }

  return { order, alreadyProcessed: false };
};

export const markPaymentFailed = async (orderId, reason = 'Payment failed') => {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order');
  if (order.paymentStatus === PAYMENT_STATUS.CAPTURED) return { order, ignored: true };

  order.paymentStatus = PAYMENT_STATUS.FAILED;
  await releaseReservations(order);
  if (![ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED].includes(order.status)) {
    setStatus(order, ORDER_STATUS.CANCELLED, { note: reason, actorType: 'system', force: true });
    order.cancelledAt = new Date();
    order.cancelledBy = 'system';
    order.cancelReason = String(reason).slice(0, 500);
  }
  await order.save();
  return { order, ignored: false };
};

const SUPPLIER_TO_ORDER_STATUS = {
  pending: null,
  accepted: ORDER_STATUS.PROCESSING,
  processing: ORDER_STATUS.PROCESSING,
  shipped: ORDER_STATUS.SHIPPED,
  delivered: ORDER_STATUS.DELIVERED,
  cancelled: ORDER_STATUS.CANCELLED,
  returned: ORDER_STATUS.RETURNED,
  failed: null,
  unknown: null
};

/**
 * Applies normalized supplier progress to the customer-facing order state.
 * Statuses are mapped through the explicit order transition table.
 */
export const applySupplierProgress = async (orderId, supplierStatus, { tracking = null, note = '' } = {}) => {
  const order = await Order.findById(orderId);
  if (!order) return null;

  if (tracking) {
    order.tracking = {
      courier: tracking.courier || order.tracking?.courier || '',
      trackingNumber: tracking.trackingNumber || order.tracking?.trackingNumber || '',
      trackingUrl: tracking.trackingUrl || order.tracking?.trackingUrl || '',
      updatedAt: new Date(),
      isMock: Boolean(tracking.mock || tracking.isMock)
    };
  }

  const mapped = SUPPLIER_TO_ORDER_STATUS[supplierStatus] ?? null;
  if (!mapped) {
    await order.save();
    return order;
  }

  if (mapped === ORDER_STATUS.CANCELLED) {
    if (order.status !== ORDER_STATUS.CANCELLED) {
      if (order.stockCommitted) {
        for (const item of order.items) {
          await restockVariant({
            productId: item.product,
            sku: item.variantSku,
            quantity: item.quantity,
            reference: { kind: 'order', id: order._id },
            note: `Supplier cancelled order ${order.orderNumber}`
          });
        }
        order.stockCommitted = false;
      } else {
        await releaseReservations(order);
      }
      setStatus(order, ORDER_STATUS.CANCELLED, {
        note: note || 'Order cancelled by supplier',
        actorType: 'supplier',
        force: true
      });
      order.cancelledAt = new Date();
      order.cancelledBy = 'supplier';
      order.cancelReason = note || 'Cancelled by supplier';
    }
    await order.save();
    return order;
  }

  if (setStatus(order, mapped, { note: note || `Supplier status: ${supplierStatus}`, actorType: 'supplier' })) {
    const now = new Date();
    if (mapped === ORDER_STATUS.PROCESSING) order.confirmedAt = order.confirmedAt || now;
    if (mapped === ORDER_STATUS.SHIPPED) order.shippedAt = now;
    if (mapped === ORDER_STATUS.DELIVERED) {
      order.deliveredAt = now;
      if (order.paymentMethod === 'cod' && order.paymentStatus !== PAYMENT_STATUS.CAPTURED) {
        order.paymentStatus = PAYMENT_STATUS.CAPTURED;
        order.amountPaid = order.total;
        order.paidAt = now;
        pushHistory(order, order.status, { note: 'COD payment collected on delivery', actorType: 'system' });
        await Payment.updateOne(
          { order: order._id, provider: 'cod' },
          { $set: { status: PAYMENT_STATUS.CAPTURED, capturedAt: now } }
        );
      }
    }
  }

  await order.save();
  return order;
};

export const markFulfilmentIssue = async (orderId, message) => {
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        'fulfilmentIssue.required': true,
        'fulfilmentIssue.message': String(message || 'Supplier fulfilment requires attention').slice(0, 1000),
        'fulfilmentIssue.at': new Date()
      }
    }
  );
};

export const clearFulfilmentIssue = async (orderId) => {
  await Order.updateOne(
    { _id: orderId },
    { $set: { 'fulfilmentIssue.required': false, 'fulfilmentIssue.message': '', 'fulfilmentIssue.at': null } }
  );
};

/**
 * Cancels pending-payment orders whose stock reservation window has elapsed so
 * inventory is never held indefinitely.
 */
export const expirePendingReservations = async ({ limit = 100 } = {}) => {
  const now = new Date();
  const candidates = await Order.find({
    status: ORDER_STATUS.PENDING_PAYMENT,
    reservationExpiresAt: { $ne: null, $lt: now }
  })
    .sort({ reservationExpiresAt: 1 })
    .limit(limit);

  let expired = 0;
  for (const order of candidates) {
    await releaseReservations(order);
    order.status = ORDER_STATUS.CANCELLED;
    order.paymentStatus = PAYMENT_STATUS.FAILED;
    order.cancelledAt = now;
    order.cancelledBy = 'expired';
    order.cancelReason = 'Payment was not completed before the stock reservation expired';
    pushHistory(order, ORDER_STATUS.CANCELLED, {
      note: 'Reservation expired before payment',
      actorType: 'system'
    });
    await order.save();
    expired += 1;
  }
  return { checked: candidates.length, expired };
};

/** Returns customer-facing timeline entries in a stable order. */
export const getOrderTimeline = (order) =>
  [...(order.statusHistory || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
