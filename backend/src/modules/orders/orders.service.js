import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { env } from '../../config/env.js';
import {
  CANCELLABLE_ORDER_STATUSES,
  ORDER_STATUS,
  RETURNABLE_ORDER_STATUSES
} from '../../constants/orderStatus.js';
import { PAYMENT_METHOD, PAYMENT_PROVIDER, PAYMENT_STATUS } from '../../constants/payment.js';
import { Order } from '../../models/Order.js';
import { Payment } from '../../models/Payment.js';
import { Product } from '../../models/Product.js';
import { User } from '../../models/User.js';
import { Coupon } from '../../models/Coupon.js';
import { generateOrderNumber } from '../../utils/orderNumber.js';
import { roundMoney, percentageOf } from '../../utils/money.js';
import { parsePagination, buildPaginationMeta } from '../../utils/http.js';
import { escapeRegex } from '../../utils/slugify.js';
import { reserveVariantStock, releaseVariantStock, restockVariant, recordInventoryTransaction } from '../inventory/inventory.service.js';
import * as cartService from '../cart/cart.service.js';
import { evaluateCoupon, redeemCoupon, releaseCoupon } from '../coupons/coupons.service.js';
import * as orderLifecycle from './orderLifecycle.service.js';
import { createPaymentForOrder, refundPaymentForOrder } from '../payments/payments.service.js';
import {
  scheduleSupplierOrdersForOrder,
  cancelSupplierOrdersForOrder
} from '../suppliers/supplierOrder.service.js';
import { logger } from '../../config/logger.js';

const PRODUCT_POPULATE = { path: 'supplier', select: 'name code isMock isActive capabilities' };

/**
 * Customer-facing order serialization. Supplier cost and internal supplier
 * identifiers never leave the backend.
 */
export const toCustomerOrder = (order) => {
  const json = order.toJSON ? order.toJSON() : { ...order };
  delete json.idempotencyKey;
  delete json.adminNote;
  delete json.supplierOrders;

  json.items = (json.items || []).map((item) => {
    const { supplierCost, supplierProductId, supplierSku, supplierVariantId, ...safe } = item;
    return safe;
  });
  json.statusHistory = (json.statusHistory || []).sort((a, b) => new Date(a.at) - new Date(b.at));
  return json;
};

const resolveAddress = (user, payload) => {
  if (payload.addressId) {
    const address = user.addresses.id(payload.addressId);
    if (!address) throw ApiError.notFound('Address');
    return {
      snapshot: {
        fullName: address.fullName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2 || '',
        landmark: address.landmark || '',
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country || 'India'
      },
      addressId: address._id
    };
  }

  if (payload.shippingAddress) {
    return { snapshot: { ...payload.shippingAddress }, addressId: null };
  }

  if (user.addresses.length === 0) {
    throw ApiError.badRequest('Add a delivery address before placing an order');
  }
  const defaultAddress = user.addresses.find((address) => address.isDefault) || user.addresses[0];
  return {
    snapshot: {
      fullName: defaultAddress.fullName,
      phone: defaultAddress.phone,
      line1: defaultAddress.line1,
      line2: defaultAddress.line2 || '',
      landmark: defaultAddress.landmark || '',
      city: defaultAddress.city,
      state: defaultAddress.state,
      pincode: defaultAddress.pincode,
      country: defaultAddress.country || 'India'
    },
    addressId: defaultAddress._id
  };
};

const mergeCheckoutItems = (items) => {
  const merged = new Map();
  for (const item of items) {
    const key = `${item.productId}:${item.sku}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      merged.set(key, { ...item });
    }
  }
  return [...merged.values()].map((item) => {
    if (item.quantity > 20) throw ApiError.badRequest('Maximum quantity per item is 20');
    return item;
  });
};

const buildOrderItems = async (requestedItems, paymentMethod) => {
  if (requestedItems.length > 50) throw ApiError.badRequest('An order can contain at most 50 different items');

  const productIds = [...new Set(requestedItems.map((item) => String(item.productId)))];
  const products = await Product.find({ _id: { $in: productIds } }).populate(PRODUCT_POPULATE);
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  const items = [];
  let subtotal = 0;
  let hasMockSupplier = false;

  for (const requested of requestedItems) {
    const product = productMap.get(String(requested.productId));
    if (!product) throw ApiError.notFound('Product');
    if (product.status !== 'active' || product.supplierStatus !== 'available') {
      throw new ApiError(409, ERROR_CODES.PRODUCT_UNAVAILABLE, `"${product.title}" is currently unavailable`);
    }
    if (!product.supplier || product.supplier.isActive === false) {
      throw new ApiError(409, ERROR_CODES.PRODUCT_UNAVAILABLE, `"${product.title}" cannot be ordered right now`);
    }

    const variant = product.variants.find((entry) => entry.sku === requested.sku);
    if (!variant || !variant.isActive) {
      throw new ApiError(409, ERROR_CODES.PRODUCT_UNAVAILABLE, `Variant "${requested.sku}" is unavailable`);
    }

    const available = Math.max(0, (variant.stock || 0) - (variant.reserved || 0));
    if (available < requested.quantity) {
      throw new ApiError(
        409,
        ERROR_CODES.INSUFFICIENT_STOCK,
        `Insufficient stock for "${product.title}" (${variant.sku}). Available: ${available}`
      );
    }

    if (paymentMethod === PAYMENT_METHOD.COD && !product.supplier.capabilities?.cod) {
      throw ApiError.badRequest(`Cash on delivery is not supported by the supplier of "${product.title}"`);
    }

    const primaryImage =
      (product.images || []).find((image) => image.isPrimary) || (product.images || [])[0] || null;
    const unitPrice = roundMoney(variant.sellingPrice);
    const lineTotal = roundMoney(unitPrice * requested.quantity);
    subtotal = roundMoney(subtotal + lineTotal);
    if (product.supplier.isMock) hasMockSupplier = true;

    items.push({
      product: product._id,
      supplier: product.supplier._id,
      supplierProductId: product.supplierProductId,
      supplierSku: product.supplierSku,
      supplierVariantId: variant.supplierVariantId || '',
      title: product.title,
      slug: product.slug,
      image: primaryImage?.url || '',
      category: product.category?._id || product.category || null,
      variantSku: variant.sku,
      variantName: variant.name,
      attributes: variant.attributes || {},
      unitPrice,
      unitMrp: variant.mrp || 0,
      supplierCost: variant.supplierCost,
      quantity: requested.quantity,
      lineTotal,
      isMockSupplier: Boolean(product.supplier.isMock)
    });
  }

  return { items, subtotal, hasMockSupplier };
};

const calculateTotals = ({ subtotal, discount, paymentMethod }) => {
  const taxableBase = Math.max(0, roundMoney(subtotal - discount));
  const shippingFee =
    taxableBase >= env.FREE_SHIPPING_THRESHOLD_INR || taxableBase === 0 ? 0 : roundMoney(env.SHIPPING_FEE_INR);
  const codFee = paymentMethod === PAYMENT_METHOD.COD ? roundMoney(env.COD_FEE_INR) : 0;
  const taxAmount = env.TAX_PERCENT > 0 ? percentageOf(taxableBase, env.TAX_PERCENT) : 0;
  const total = roundMoney(taxableBase + shippingFee + codFee + taxAmount);
  return {
    subtotal,
    discount: roundMoney(discount),
    shippingFee,
    codFee,
    taxAmount,
    total
  };
};

const reserveItems = async (orderItems, orderIdForLog) => {
  const reserved = [];
  for (const item of orderItems) {
    const product = await reserveVariantStock(item.product, item.variantSku, item.quantity);
    reserved.push(item);
    const variant = product.variants.find((entry) => entry.sku === item.variantSku);
    await recordInventoryTransaction({
      productId: item.product,
      sku: item.variantSku,
      type: 'reservation',
      quantity: item.quantity,
      previousStock: variant?.stock || 0,
      newStock: variant?.stock || 0,
      reference: { kind: 'order', id: orderIdForLog || null },
      note: 'Stock reserved for checkout'
    });
  }
  return reserved;
};

const releaseReservedItems = async (items) => {
  for (const item of items) {
    await releaseVariantStock(item.product, item.variantSku, item.quantity);
  }
};

const findExistingByIdempotency = async (userId, idempotencyKey) => {
  if (!idempotencyKey) return null;
  return Order.findOne({ user: userId, idempotencyKey });
};

export const createOrder = async (user, payload, { idempotencyKey, requestId = '' } = {}) => {
  const existing = await findExistingByIdempotency(user._id, idempotencyKey);
  if (existing) {
    return { order: toCustomerOrder(existing), replay: true, payment: null };
  }

  if (payload.paymentMethod === PAYMENT_METHOD.ONLINE) {
    const paymentsService = await import('../payments/payments.service.js');
    if (!paymentsService.isPaymentGatewayAvailable()) {
      throw new ApiError(
        503,
        ERROR_CODES.PAYMENT_NOT_CONFIGURED,
        'Online payments are not configured. Configure Razorpay test keys or enable PAYMENTS_MOCK_MODE.'
      );
    }
  }

  const userDoc = await User.findById(user._id);
  if (!userDoc) throw ApiError.notFound('User');

  const usesCart = !payload.items || payload.items.length === 0;
  const requestedItems = usesCart ? await cartService.listCartItemsForCheckout(user._id) : payload.items;
  if (!requestedItems.length) throw ApiError.badRequest('Your cart is empty');

  const mergedItems = mergeCheckoutItems(
    requestedItems.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      quantity: item.quantity
    }))
  );

  const { items, subtotal, hasMockSupplier } = await buildOrderItems(mergedItems, payload.paymentMethod);
  const address = resolveAddress(userDoc, payload);

  let couponResult = null;
  let coupon = null;
  const couponBaseItems = items.map((item) => ({
    product: item.product,
    category: item.category,
    quantity: item.quantity,
    lineTotal: item.lineTotal
  }));

  if (payload.couponCode) {
    couponResult = await evaluateCoupon({
      code: payload.couponCode,
      userId: user._id,
      items: couponBaseItems,
      subtotal
    });
    coupon = await redeemCoupon(couponResult.coupon.couponId);
    if (!coupon) {
      throw new ApiError(400, ERROR_CODES.INVALID_COUPON, 'This coupon has reached its usage limit');
    }
  }

  const totals = calculateTotals({
    subtotal,
    discount: couponResult?.discount || 0,
    paymentMethod: payload.paymentMethod
  });

  const reservationExpiresAt =
    payload.paymentMethod === PAYMENT_METHOD.ONLINE
      ? new Date(Date.now() + env.ORDER_RESERVATION_TTL_MINUTES * 60 * 1000)
      : null;

  let reservedItems = [];
  let order;

  try {
    const orderNumber = await generateOrderNumber();
    order = new Order({
      orderNumber,
      user: user._id,
      items,
      shippingAddress: address.snapshot,
      shippingAddressId: address.addressId,
      subtotal: totals.subtotal,
      discount: totals.discount,
      shippingFee: totals.shippingFee,
      codFee: totals.codFee,
      taxAmount: totals.taxAmount,
      total: totals.total,
      coupon: {
        couponId: couponResult?.coupon.couponId || null,
        code: couponResult?.coupon.code || '',
        discount: totals.discount
      },
      paymentMethod: payload.paymentMethod,
      paymentStatus: payload.paymentMethod === PAYMENT_METHOD.COD ? PAYMENT_STATUS.COD_PENDING : PAYMENT_STATUS.PENDING,
      status: ORDER_STATUS.PENDING_PAYMENT,
      stockReserved: true,
      reservationExpiresAt,
      hasMockSupplier,
      customerNote: payload.customerNote || '',
      idempotencyKey: idempotencyKey || null
    });
    order.statusHistory.push({
      status: ORDER_STATUS.PENDING_PAYMENT,
      note: 'Order created',
      actorType: 'customer',
      actor: user._id
    });

    reservedItems = await reserveItems(items, order._id);
    await order.save();
  } catch (error) {
    if (reservedItems.length) await releaseReservedItems(reservedItems);
    if (coupon) await releaseCoupon(coupon._id);

    if (error?.code === 11000 && idempotencyKey) {
      const duplicate = await findExistingByIdempotency(user._id, idempotencyKey);
      if (duplicate) return { order: toCustomerOrder(duplicate), replay: true, payment: null };
    }
    throw error;
  }

  if (usesCart) {
    await cartService.clearCartInternal(user._id);
  }

  let payment = null;
  if (payload.paymentMethod === PAYMENT_METHOD.COD) {
    await orderLifecycle.confirmCodOrder(order._id);
    const { recordCodPayment } = await import('../payments/payments.service.js');
    await recordCodPayment(order);
    try {
      await scheduleSupplierOrdersForOrder(order);
    } catch (error) {
      logger.error({ err: error, orderId: String(order._id) }, 'COD supplier order scheduling failed');
      await orderLifecycle.markFulfilmentIssue(
        order._id,
        'Supplier order submission requires attention. Retry from the admin supplier-orders module.'
      );
    }
  } else {
    payment = await createPaymentForOrder(user._id, order._id, { requestId });
  }

  const freshOrder = await Order.findById(order._id);
  return { order: toCustomerOrder(freshOrder), replay: false, payment };
};

const ensureOwnedOrder = async (user, identifier) => {
  const filter = mongoose.Types.ObjectId.isValid(identifier) ? { _id: identifier } : { orderNumber: identifier };
  const order = await Order.findOne({ ...filter, user: user._id });
  if (!order) throw ApiError.notFound('Order');
  return order;
};

export const listMyOrders = async (user, query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 10, maxLimit: 50 });
  const filter = { user: user._id };
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = query.from;
    if (query.to) filter.createdAt.$lte = query.to;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter)
  ]);

  return {
    orders: orders.map(toCustomerOrder),
    meta: buildPaginationMeta({ page, limit, total })
  };
};

export const getMyOrder = async (user, identifier) => toCustomerOrder(await ensureOwnedOrder(user, identifier));

export const cancelMyOrder = async (user, orderId, reason) => {
  const order = await ensureOwnedOrder(user, orderId);
  if (!CANCELLABLE_ORDER_STATUSES.includes(order.status)) {
    throw new ApiError(
      409,
      ERROR_CODES.INVALID_STATE_TRANSITION,
      `An order in "${order.status}" state cannot be cancelled`
    );
  }

  const supplierCancellation = await cancelSupplierOrdersForOrder(order, reason);
  if (supplierCancellation.requiresManual) {
    throw new ApiError(
      409,
      ERROR_CODES.SUPPLIER_ERROR,
      'The supplier has already started fulfilling this order and does not support API cancellation. Please contact support.'
    );
  }

  if (order.stockCommitted) {
    for (const item of order.items) {
      await restockVariant({
        productId: item.product,
        sku: item.variantSku,
        quantity: item.quantity,
        reference: { kind: 'order', id: order._id },
        note: `Order ${order.orderNumber} cancelled by customer`
      });
    }
    order.stockCommitted = false;
  } else {
    await orderLifecycle.releaseReservations(order);
  }

  if (order.coupon?.couponId) await releaseCoupon(order.coupon.couponId);

  let refund = null;
  if (
    [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED].includes(order.paymentStatus) &&
    order.amountPaid > order.amountRefunded &&
    order.paymentMethod === PAYMENT_METHOD.ONLINE
  ) {
    try {
      refund = await refundPaymentForOrder(order, {
        amount: roundMoney(order.amountPaid - order.amountRefunded),
        reason: `Customer cancellation: ${reason}`,
        initiatedBy: user._id
      });
    } catch (error) {
      logger.error({ err: error, orderId: String(order._id) }, 'Automatic refund after cancellation failed');
      await orderLifecycle.markFulfilmentIssue(
        order._id,
        'Order cancelled but the automatic refund could not be processed. Admin refund required.'
      );
    }
  }

  order.status = ORDER_STATUS.CANCELLED;
  order.cancelledAt = new Date();
  order.cancelledBy = 'customer';
  order.cancelReason = String(reason).slice(0, 500);
  order.statusHistory.push({
    status: ORDER_STATUS.CANCELLED,
    note: reason,
    actorType: 'customer',
    actor: user._id,
    at: new Date()
  });
  await order.save();

  const freshOrder = await Order.findById(order._id);
  return { order: toCustomerOrder(freshOrder || order), refund };
};

export const requestReturn = async (user, orderId, { reason, note }) => {
  const order = await ensureOwnedOrder(user, orderId);
  if (order.returnRequest?.status !== 'none') {
    throw ApiError.conflict('A return request already exists for this order');
  }
  if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) {
    throw new ApiError(409, ERROR_CODES.INVALID_STATE_TRANSITION, 'Only delivered orders can be returned');
  }
  if (order.deliveredAt) {
    const windowMs = env.RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(order.deliveredAt).getTime() > windowMs) {
      throw ApiError.badRequest(`The ${env.RETURN_WINDOW_DAYS}-day return window has expired`);
    }
  }

  order.returnRequest = {
    status: 'requested',
    reason: String(reason).slice(0, 500),
    note: String(note || '').slice(0, 1000),
    requestedAt: new Date(),
    resolvedAt: null,
    resolutionNote: ''
  };
  order.status = ORDER_STATUS.RETURN_REQUESTED;
  order.statusHistory.push({
    status: ORDER_STATUS.RETURN_REQUESTED,
    note: reason,
    actorType: 'customer',
    actor: user._id,
    at: new Date()
  });
  await order.save();
  return toCustomerOrder(order);
};

export const listOrdersAdmin = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.userId) filter.user = query.userId;
  if (query.supplierId) filter['items.supplier'] = query.supplierId;
  if (query.fulfilmentIssue !== undefined) {
    filter['fulfilmentIssue.required'] = query.fulfilmentIssue === 'true';
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = query.from;
    if (query.to) filter.createdAt.$lte = query.to;
  }
  if (query.q) {
    const regex = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ orderNumber: regex }, { 'shippingAddress.fullName': regex }, { 'shippingAddress.phone': regex }];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'user', select: 'name email phone' }),
    Order.countDocuments(filter)
  ]);

  return { orders, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getOrderAdmin = async (orderId) => {
  const order = await Order.findById(orderId)
    .populate({ path: 'user', select: 'name email phone isActive' })
    .populate({ path: 'supplierOrders' });
  if (!order) throw ApiError.notFound('Order');
  return order;
};

export const adminUpdateStatus = async (orderId, { status, note }, adminId) => {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order');
  if (order.status === status) return order;

  const { canTransitionOrderStatus } = await import('../../constants/orderStatus.js');
  if (!canTransitionOrderStatus(order.status, status)) {
    throw new ApiError(
      409,
      ERROR_CODES.INVALID_STATE_TRANSITION,
      `Cannot move an order from "${order.status}" to "${status}"`
    );
  }

  if (status === ORDER_STATUS.CANCELLED) {
    const supplierCancellation = await cancelSupplierOrdersForOrder(order, note || 'Cancelled by admin');
    if (supplierCancellation.requiresManual) {
      throw new ApiError(409, ERROR_CODES.SUPPLIER_ERROR, 'Supplier does not support API cancellation');
    }
    if (order.stockCommitted) {
      for (const item of order.items) {
        await restockVariant({
          productId: item.product,
          sku: item.variantSku,
          quantity: item.quantity,
          reference: { kind: 'order', id: order._id },
          note: `Order ${order.orderNumber} cancelled by admin`
        });
      }
      order.stockCommitted = false;
    } else {
      await orderLifecycle.releaseReservations(order);
    }
    if (order.coupon?.couponId) await releaseCoupon(order.coupon.couponId);
    order.cancelledAt = new Date();
    order.cancelledBy = 'admin';
    order.cancelReason = note || 'Cancelled by admin';
  }

  if (status === ORDER_STATUS.SHIPPED) order.shippedAt = new Date();
  if (status === ORDER_STATUS.DELIVERED) {
    order.deliveredAt = new Date();
    if (order.paymentMethod === PAYMENT_METHOD.COD && order.paymentStatus !== PAYMENT_STATUS.CAPTURED) {
      order.paymentStatus = PAYMENT_STATUS.CAPTURED;
      order.amountPaid = order.total;
      order.paidAt = order.paidAt || new Date();
      await Payment.updateOne(
        { order: order._id, provider: PAYMENT_PROVIDER.COD },
        { $set: { status: PAYMENT_STATUS.CAPTURED, capturedAt: order.paidAt } }
      );
    }
  }

  order.status = status;
  order.statusHistory.push({
    status,
    note: note || `Status changed by admin`,
    actorType: 'admin',
    actor: adminId,
    at: new Date()
  });
  await order.save();
  return order;
};

export const adminUpdateTracking = async (orderId, payload) => {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order');
  order.tracking = {
    courier: payload.courier || '',
    trackingNumber: payload.trackingNumber || '',
    trackingUrl: payload.trackingUrl || '',
    isMock: Boolean(payload.isMock),
    updatedAt: new Date()
  };
  order.statusHistory.push({
    status: order.status,
    note: payload.note || 'Tracking information updated by admin',
    actorType: 'admin',
    at: new Date()
  });
  await order.save();
  return order;
};

export const adminAddNote = async (orderId, adminNote) => {
  const order = await Order.findByIdAndUpdate(orderId, { $set: { adminNote } }, { new: true });
  if (!order) throw ApiError.notFound('Order');
  return order;
};

export const adminResolveReturn = async (orderId, { decision, note }, adminId) => {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order');
  if (order.returnRequest?.status !== 'requested') {
    throw ApiError.conflict('This order has no pending return request');
  }
  const approved = decision === 'approve';
  order.returnRequest.status = approved ? 'approved' : 'rejected';
  order.returnRequest.resolvedAt = new Date();
  order.returnRequest.resolutionNote = String(note || '').slice(0, 1000);

  if (approved) {
    order.status = ORDER_STATUS.RETURNED;
    order.statusHistory.push({
      status: ORDER_STATUS.RETURNED,
      note: note || 'Return approved by admin',
      actorType: 'admin',
      actor: adminId,
      at: new Date()
    });
    if (order.stockCommitted) {
      for (const item of order.items) {
        await restockVariant({
          productId: item.product,
          sku: item.variantSku,
          quantity: item.quantity,
          reference: { kind: 'order', id: order._id },
          note: `Return accepted for ${order.orderNumber}`
        });
      }
      order.stockCommitted = false;
    }
    order.returnRequest.status = 'completed';
  } else {
    order.status = ORDER_STATUS.DELIVERED;
    order.statusHistory.push({
      status: ORDER_STATUS.DELIVERED,
      note: note || 'Return rejected by admin',
      actorType: 'admin',
      actor: adminId,
      at: new Date()
    });
  }

  await order.save();
  return order;
};

export const adminRefundOrder = async (orderId, { amount, reason, restock = false }, adminId) => {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order');
  if (![PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED].includes(order.paymentStatus)) {
    throw new ApiError(409, ERROR_CODES.INVALID_STATE_TRANSITION, 'This order has no captured payment to refund');
  }

  const remaining = roundMoney(order.amountPaid - order.amountRefunded);
  if (remaining <= 0) throw ApiError.conflict('This payment has already been fully refunded');
  const refundAmount = amount ? roundMoney(Math.min(amount, remaining)) : remaining;

  const refund = await refundPaymentForOrder(order, {
    amount: refundAmount,
    reason,
    initiatedBy: adminId
  });

  if (restock && order.stockCommitted) {
    for (const item of order.items) {
      await restockVariant({
        productId: item.product,
        sku: item.variantSku,
        quantity: item.quantity,
        reference: { kind: 'order', id: order._id },
        note: `Refund restock for ${order.orderNumber}`
      });
    }
    order.stockCommitted = false;
  }

  const refreshed = await Order.findById(order._id);
  const fullyRefunded = roundMoney(refreshed.amountRefunded) >= roundMoney(refreshed.amountPaid);
  refreshed.status = fullyRefunded ? ORDER_STATUS.REFUNDED : refreshed.status;
  if (fullyRefunded) {
    refreshed.statusHistory.push({
      status: ORDER_STATUS.REFUNDED,
      note: `Refund processed: ${reason}`,
      actorType: 'admin',
      actor: adminId,
      at: new Date()
    });
  }
  await refreshed.save();

  return { order: refreshed, refund, fullyRefunded };
};

export const countOrdersByStatus = async () => {
  const rows = await Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  return rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
};

export const getRawOrderDoc = async (orderId) => Order.findById(orderId);
