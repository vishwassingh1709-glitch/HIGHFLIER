import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import {
  NORMALIZED_SUPPLIER_STATUS,
  SUPPLIER_ORDER_STATUS,
  canTransitionSupplierOrderStatus
} from '../../constants/supplier.js';
import { SupplierOrder } from '../../models/SupplierOrder.js';
import { Order } from '../../models/Order.js';
import { Supplier } from '../../models/Supplier.js';
import { User } from '../../models/User.js';
import { createSupplierAdapter } from './adapters/index.js';
import { SupplierAdapterError } from './adapters/errors.js';
import { createSyncLog } from './syncLog.service.js';
import { syncLogTypeForStatus } from './supplierOrder.helpers.js';
import * as orderLifecycle from '../orders/orderLifecycle.service.js';
import { buildPaginationMeta, parsePagination } from '../../utils/http.js';
import { escapeRegex } from '../../utils/slugify.js';
import { logger } from '../../config/logger.js';

const NORMALIZED_TO_SUPPLIER_STATUS = {
  [NORMALIZED_SUPPLIER_STATUS.PENDING]: SUPPLIER_ORDER_STATUS.SUBMITTED,
  [NORMALIZED_SUPPLIER_STATUS.ACCEPTED]: SUPPLIER_ORDER_STATUS.ACCEPTED,
  [NORMALIZED_SUPPLIER_STATUS.PROCESSING]: SUPPLIER_ORDER_STATUS.PROCESSING,
  [NORMALIZED_SUPPLIER_STATUS.SHIPPED]: SUPPLIER_ORDER_STATUS.SHIPPED,
  [NORMALIZED_SUPPLIER_STATUS.DELIVERED]: SUPPLIER_ORDER_STATUS.DELIVERED,
  [NORMALIZED_SUPPLIER_STATUS.CANCELLED]: SUPPLIER_ORDER_STATUS.CANCELLED_BY_SUPPLIER,
  [NORMALIZED_SUPPLIER_STATUS.RETURNED]: SUPPLIER_ORDER_STATUS.RETURNED,
  [NORMALIZED_SUPPLIER_STATUS.FAILED]: SUPPLIER_ORDER_STATUS.FAILED
};

const TERMINAL_STATUSES = [
  SUPPLIER_ORDER_STATUS.CANCELLED,
  SUPPLIER_ORDER_STATUS.CANCELLED_BY_SUPPLIER,
  SUPPLIER_ORDER_STATUS.RETURNED
];

const ACTIVE_STATUSES = [
  SUPPLIER_ORDER_STATUS.SUBMITTED,
  SUPPLIER_ORDER_STATUS.ACCEPTED,
  SUPPLIER_ORDER_STATUS.PROCESSING,
  SUPPLIER_ORDER_STATUS.SHIPPED
];

const limitPayload = (value) => {
  try {
    const text = JSON.stringify(value ?? {});
    if (text.length <= 20000) return JSON.parse(text);
    return { truncated: true, preview: text.slice(0, 20000) };
  } catch {
    return { unserializable: true };
  }
};

const addHistory = (supplierOrder, status, { note = '', source = 'system' } = {}) => {
  supplierOrder.statusHistory.push({ status, note, source, at: new Date() });
};

const buildIdempotencyKey = (order, supplierId) =>
  `hf:${order.orderNumber}:${String(supplierId)}`.slice(0, 128);

const findSupplierOrder = async (id) => {
  const supplierOrder = await SupplierOrder.findById(id)
    .populate({ path: 'order', select: 'orderNumber status total paymentStatus shippingAddress user items' })
    .populate({ path: 'supplier', select: 'name code isMock isActive adapterType capabilities' });
  if (!supplierOrder) throw ApiError.notFound('Supplier order');
  return supplierOrder;
};

/**
 * Groups order items per supplier and creates one SupplierOrder per supplier.
 * Immediate submission is attempted only for suppliers that advertise an order
 * placement API. Suppliers without that capability become action_required.
 */
export const scheduleSupplierOrdersForOrder = async (orderInput) => {
  const order = orderInput?.toObject ? await Order.findById(orderInput._id) : await Order.findById(orderInput);
  if (!order) throw ApiError.notFound('Order');

  const groupMap = new Map();
  for (const item of order.items) {
    const key = String(item.supplier);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(item);
  }

  const supplierIds = [...groupMap.keys()];
  const suppliers = await Supplier.find({ _id: { $in: supplierIds } }).select('+credentials');
  const supplierMap = new Map(suppliers.map((supplier) => [String(supplier._id), supplier]));
  const user = await User.findById(order.user);

  const created = [];
  for (const [supplierId, items] of groupMap.entries()) {
    const supplier = supplierMap.get(supplierId);
    const idempotencyKey = buildIdempotencyKey(order, supplierId);

    let supplierOrder = await SupplierOrder.findOne({ idempotencyKey });
    if (!supplierOrder) {
      supplierOrder = await SupplierOrder.create({
        order: order._id,
        supplier: supplierId,
        orderNumber: order.orderNumber,
        items: items.map((item) => ({
          orderItemId: item._id,
          product: item.product,
          supplierProductId: item.supplierProductId,
          supplierSku: item.supplierSku,
          supplierVariantId: item.supplierVariantId,
          sku: item.variantSku,
          title: item.title,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          supplierCost: item.supplierCost
        })),
        supplierCost: items.reduce((sum, item) => sum + item.supplierCost * item.quantity, 0),
        idempotencyKey,
        status: SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION,
        isMock: Boolean(supplier?.isMock),
        requestPayload: limitPayload({
          orderNumber: order.orderNumber,
          shippingAddress: order.shippingAddress,
          itemCount: items.length
        })
      });
      addHistory(supplierOrder, SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION, {
        note: 'Supplier order created from paid order'
      });
      await supplierOrder.save();
    }

    await Order.updateOne({ _id: order._id }, { $addToSet: { supplierOrders: supplierOrder._id } });

    if (!supplier || !supplier.isActive) {
      await markActionRequired(supplierOrder, 'Supplier is missing or inactive. Fulfilment cannot be submitted.');
      created.push(supplierOrder);
      continue;
    }
    if (!supplier.capabilities?.orderPlacement) {
      await markActionRequired(
        supplierOrder,
        'Supplier has no order placement API capability. Fulfil manually or configure an authorised adapter.'
      );
      created.push(supplierOrder);
      continue;
    }

    if (supplierOrder.status === SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION) {
      try {
        created.push(await submitSupplierOrder(supplierOrder._id, { user }));
      } catch (error) {
        logger.error({ err: error, supplierOrderId: String(supplierOrder._id) }, 'Supplier order submission failed');
        created.push(await SupplierOrder.findById(supplierOrder._id));
      }
    } else {
      created.push(supplierOrder);
    }
  }

  await refreshOrderFulfilmentState(order._id);
  return created.filter(Boolean);
};

const markActionRequired = async (supplierOrder, message) => {
  supplierOrder.status = SUPPLIER_ORDER_STATUS.ACTION_REQUIRED;
  supplierOrder.lastError = String(message).slice(0, 2000);
  supplierOrder.retryable = false;
  supplierOrder.nextRetryAt = null;
  addHistory(supplierOrder, SUPPLIER_ORDER_STATUS.ACTION_REQUIRED, { note: message });
  await supplierOrder.save();
  await orderLifecycle.markFulfilmentIssue(supplierOrder.order, message);
  await createSyncLog({
    supplier: supplierOrder.supplier,
    type: 'order_submit',
    status: 'failed',
    message,
    errors: [{ message, context: supplierOrder.orderNumber }],
    triggeredBy: 'system'
  });
};

const nextRetryDate = (attempts) => {
  const delayMinutes = Math.min(30, 2 ** Math.min(attempts, 5));
  return new Date(Date.now() + delayMinutes * 60 * 1000);
};

/**
 * Submits a supplier order if it is pending, failed, or action_required. The
 * claim update is atomic so two workers cannot submit the same order twice.
 * The supplier-facing idempotency key is stable across retries.
 */
export const submitSupplierOrder = async (supplierOrderId, { user = null, actor = null } = {}) => {
  const claimed = await SupplierOrder.findOneAndUpdate(
    {
      _id: supplierOrderId,
      status: {
        $in: [
          SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION,
          SUPPLIER_ORDER_STATUS.FAILED,
          SUPPLIER_ORDER_STATUS.ACTION_REQUIRED
        ]
      }
    },
    { $set: { status: SUPPLIER_ORDER_STATUS.SUBMITTING, lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!claimed) return findSupplierOrder(supplierOrderId);

  const supplierOrder = await findSupplierOrder(supplierOrderId);
  const order = supplierOrder.order;
  const supplier = supplierOrder.supplier;

  const release = async (message) => {
    await SupplierOrder.updateOne(
      { _id: supplierOrder._id, status: SUPPLIER_ORDER_STATUS.SUBMITTING },
      { $set: { status: SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION, lastError: message } }
    );
  };

  if (!supplier || !supplier.isActive) {
    await markActionRequired(supplierOrder, 'Supplier is missing or inactive');
    return supplierOrder;
  }
  if (!supplier.capabilities?.orderPlacement) {
    await markActionRequired(supplierOrder, 'Supplier does not support order placement via API');
    return supplierOrder;
  }

  const customer = user || (await User.findById(order.user));
  const requestPayload = {
    idempotencyKey: supplierOrder.idempotencyKey,
    orderNumber: supplierOrder.orderNumber,
    customer: {
      name: order.shippingAddress?.fullName || customer?.name || '',
      email: customer?.email || '',
      phone: order.shippingAddress?.phone || ''
    },
    shippingAddress: order.shippingAddress,
    paymentMethod: order.paymentMethod,
    items: supplierOrder.items.map((item) => ({
      supplierProductId: item.supplierProductId,
      supplierSku: item.supplierSku,
      supplierVariantId: item.supplierVariantId,
      sku: item.sku,
      name: item.title,
      quantity: item.quantity,
      supplierCost: item.supplierCost
    })),
    notes: { orderNumber: supplierOrder.orderNumber }
  };

  supplierOrder.requestPayload = limitPayload(requestPayload);
  const startedAt = new Date();

  try {
    const supplierDoc = await Supplier.findById(supplier._id).select('+credentials');
    const adapter = createSupplierAdapter(supplierDoc);
    const result = await adapter.createSupplierOrder(requestPayload);
    const normalized = result.normalizedStatus || NORMALIZED_SUPPLIER_STATUS.ACCEPTED;
    const mappedStatus = NORMALIZED_TO_SUPPLIER_STATUS[normalized] || SUPPLIER_ORDER_STATUS.SUBMITTED;

    supplierOrder.supplierOrderId = result.supplierOrderId || '';
    supplierOrder.responsePayload = limitPayload(result.rawResponse || result);
    supplierOrder.rawStatus = String(result.status || normalized).slice(0, 120);
    supplierOrder.submittedAt = supplierOrder.submittedAt || new Date();
    supplierOrder.retryable = false;
    supplierOrder.nextRetryAt = null;
    supplierOrder.lastError = '';

    const targetStatus =
      mappedStatus === SUPPLIER_ORDER_STATUS.SHIPPED || mappedStatus === SUPPLIER_ORDER_STATUS.DELIVERED
        ? mappedStatus
        : mappedStatus;

    if (canTransitionSupplierOrderStatus(SUPPLIER_ORDER_STATUS.SUBMITTING, targetStatus)) {
      supplierOrder.status = targetStatus;
      addHistory(supplierOrder, targetStatus, {
        note: `Supplier accepted submission${result.idempotentReplay ? ' (idempotent replay)' : ''}`,
        source: 'supplier'
      });
    } else {
      supplierOrder.status = SUPPLIER_ORDER_STATUS.SUBMITTED;
      addHistory(supplierOrder, SUPPLIER_ORDER_STATUS.SUBMITTED, { note: 'Order submitted', source: 'system' });
    }
    if (supplierOrder.status === SUPPLIER_ORDER_STATUS.ACCEPTED) supplierOrder.acceptedAt = new Date();
    if (supplierOrder.status === SUPPLIER_ORDER_STATUS.SHIPPED) supplierOrder.shippedAt = new Date();
    if (supplierOrder.status === SUPPLIER_ORDER_STATUS.DELIVERED) supplierOrder.deliveredAt = new Date();
    supplierOrder.isMock = Boolean(result.mock || supplier.isMock);
    await supplierOrder.save();

    await createSyncLog({
      supplier: supplier._id,
      type: 'order_submit',
      status: 'success',
      message: result.mock
        ? 'MOCK supplier order accepted locally. No real supplier was contacted.'
        : 'Supplier order submitted successfully',
      triggeredBy: actor ? 'manual' : 'system',
      triggeredByUser: actor || null,
      startedAt,
      finishedAt: new Date()
    });

    await orderLifecycle.applySupplierProgress(order._id, normalized, {
      note: result.mock ? 'Mock supplier accepted the order (no real fulfilment)' : ''
    });
    await refreshOrderFulfilmentState(order._id);
    return findSupplierOrder(supplierOrder._id);
  } catch (error) {
    const retryable =
      error instanceof SupplierAdapterError
        ? error.retryable
        : Boolean(error?.retryable) || [429, 500, 502, 503, 504].includes(error?.statusCode);
    const message = String(error.message || 'Supplier order submission failed').slice(0, 2000);

    if (retryable) {
      supplierOrder.status = SUPPLIER_ORDER_STATUS.FAILED;
      supplierOrder.retryable = true;
      supplierOrder.nextRetryAt = nextRetryDate(supplierOrder.attempts);
    } else {
      supplierOrder.status = SUPPLIER_ORDER_STATUS.ACTION_REQUIRED;
      supplierOrder.retryable = false;
      supplierOrder.nextRetryAt = null;
    }
    supplierOrder.lastError = message;
    supplierOrder.responsePayload = limitPayload(error?.details || error?.response || {});
    addHistory(supplierOrder, supplierOrder.status, { note: message });
    await supplierOrder.save();

    await createSyncLog({
      supplier: supplier._id,
      type: 'order_submit',
      status: 'failed',
      message,
      errors: [{ message, context: supplierOrder.orderNumber }],
      triggeredBy: actor ? 'manual' : 'system',
      triggeredByUser: actor || null,
      startedAt,
      finishedAt: new Date()
    });

    await orderLifecycle.markFulfilmentIssue(
      order._id,
      retryable
        ? 'Supplier submission failed (temporary). Automatic retry is scheduled.'
        : 'Supplier submission requires admin action.'
    );

    return findSupplierOrder(supplierOrder._id);
  }
};

export const refreshOrderFulfilmentState = async (orderId) => {
  const supplierOrders = await SupplierOrder.find({ order: orderId });
  if (supplierOrders.length === 0) return;
  const needsAttention = supplierOrders.some((supplierOrder) =>
    [SUPPLIER_ORDER_STATUS.FAILED, SUPPLIER_ORDER_STATUS.ACTION_REQUIRED].includes(supplierOrder.status)
  );
  if (needsAttention) {
    await orderLifecycle.markFulfilmentIssue(
      orderId,
      'One or more supplier orders require attention. Review the supplier-orders module.'
    );
  } else {
    await orderLifecycle.clearFulfilmentIssue(orderId);
  }
};

/**
 * Pulls the latest status/tracking for one supplier order and maps it onto the
 * customer order. Failures are logged and retried by the scheduler.
 */
export const syncSupplierOrderStatus = async (supplierOrderId, { actor = null, requestId = '' } = {}) => {
  const supplierOrder = await findSupplierOrder(supplierOrderId);
  if (!supplierOrder.supplierOrderId) return supplierOrder;
  if (TERMINAL_STATUSES.includes(supplierOrder.status)) return supplierOrder;
  if (!supplierOrder.supplier?.capabilities?.orderStatus) return supplierOrder;

  const startedAt = new Date();
  try {
    const supplierDoc = await Supplier.findById(supplierOrder.supplier._id).select('+credentials');
    const adapter = createSupplierAdapter(supplierDoc);
    const statusResult = await adapter.getOrderStatus(supplierOrder.supplierOrderId);
    const normalized = statusResult.normalizedStatus || statusResult.status || NORMALIZED_SUPPLIER_STATUS.UNKNOWN;
    supplierOrder.rawStatus = String(statusResult.status || normalized).slice(0, 120);
    supplierOrder.lastSyncedAt = new Date();

    let tracking = null;
    if (
      ['shipped', 'delivered'].includes(normalized) &&
      supplierOrder.supplier.capabilities?.tracking
    ) {
      try {
        tracking = await adapter.getTrackingDetails(supplierOrder.supplierOrderId);
        if (tracking) {
          supplierOrder.tracking = {
            courier: tracking.courier || '',
            trackingNumber: tracking.trackingNumber || '',
            trackingUrl: tracking.trackingUrl || '',
            updatedAt: new Date(),
            isMock: Boolean(tracking.mock || supplierOrder.isMock)
          };
        }
      } catch (error) {
        logger.warn({ err: error, supplierOrderId: String(supplierOrder._id) }, 'Tracking lookup failed');
      }
    }

    const mapped = NORMALIZED_TO_SUPPLIER_STATUS[normalized];
    if (mapped && mapped !== supplierOrder.status) {
      if (canTransitionSupplierOrderStatus(supplierOrder.status, mapped)) {
        supplierOrder.status = mapped;
        addHistory(supplierOrder, mapped, {
          note: `Supplier status: ${normalized}${supplierOrder.isMock ? ' (mock)' : ''}`,
          source: 'supplier'
        });
        const now = new Date();
        if (mapped === SUPPLIER_ORDER_STATUS.ACCEPTED) supplierOrder.acceptedAt = now;
        if (mapped === SUPPLIER_ORDER_STATUS.SHIPPED) supplierOrder.shippedAt = now;
        if (mapped === SUPPLIER_ORDER_STATUS.DELIVERED) supplierOrder.deliveredAt = now;
        if (
          mapped === SUPPLIER_ORDER_STATUS.CANCELLED ||
          mapped === SUPPLIER_ORDER_STATUS.CANCELLED_BY_SUPPLIER
        ) {
          supplierOrder.cancelledAt = now;
        }
      }
    }

    await supplierOrder.save();
    await orderLifecycle.applySupplierProgress(supplierOrder.order._id || supplierOrder.order, normalized, {
      tracking,
      note: supplierOrder.isMock ? 'Mock supplier status update (no real fulfilment)' : ''
    });

    if (tracking) {
      await createSyncLog({
        supplier: supplierOrder.supplier._id,
        type: 'tracking',
        status: 'success',
        message: 'Tracking details synchronised',
        triggeredBy: actor ? 'manual' : 'cron',
        triggeredByUser: actor || null,
        requestId,
        startedAt,
        finishedAt: new Date()
      });
    }

    await createSyncLog({
      supplier: supplierOrder.supplier._id,
      type: syncLogTypeForStatus(mapped),
      status: 'success',
      message: `Supplier order ${supplierOrder.orderNumber} status: ${normalized}`,
      triggeredBy: actor ? 'manual' : 'cron',
      triggeredByUser: actor || null,
      requestId,
      startedAt,
      finishedAt: new Date()
    });

    await refreshOrderFulfilmentState(supplierOrder.order._id || supplierOrder.order);
    return findSupplierOrder(supplierOrder._id);
  } catch (error) {
    supplierOrder.lastError = String(error.message || 'Status sync failed').slice(0, 2000);
    supplierOrder.lastSyncedAt = new Date();
    await supplierOrder.save();
    await createSyncLog({
      supplier: supplierOrder.supplier._id,
      type: 'order_status',
      status: 'failed',
      message: 'Supplier status sync failed',
      errors: [{ message: error.message, context: supplierOrder.orderNumber }],
      triggeredBy: actor ? 'manual' : 'cron',
      triggeredByUser: actor || null,
      requestId,
      startedAt,
      finishedAt: new Date()
    });
    logger.warn({ err: error, supplierOrderId: String(supplierOrder._id) }, 'Supplier status sync failed');
    return findSupplierOrder(supplierOrder._id);
  }
};

export const syncSupplierOrdersForOrder = async (orderId) => {
  const supplierOrders = await SupplierOrder.find({
    order: orderId,
    status: { $in: ACTIVE_STATUSES }
  });
  const results = [];
  for (const supplierOrder of supplierOrders) {
    results.push(await syncSupplierOrderStatus(supplierOrder._id));
  }
  return results;
};

export const retryDueSupplierOrders = async ({ limit = 50 } = {}) => {
  const now = new Date();
  const due = await SupplierOrder.find({
    $or: [
      { status: SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION },
      {
        status: SUPPLIER_ORDER_STATUS.FAILED,
        $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }]
      }
    ]
  })
    .sort({ lastAttemptAt: 1 })
    .limit(limit);

  const results = [];
  for (const supplierOrder of due) {
    try {
      results.push(await submitSupplierOrder(supplierOrder._id));
    } catch (error) {
      logger.error({ err: error, supplierOrderId: String(supplierOrder._id) }, 'Scheduled supplier retry failed');
    }
  }
  return { attempted: due.length, results };
};

export const syncActiveSupplierOrders = async ({ limit = 100 } = {}) => {
  const active = await SupplierOrder.find({
    status: { $in: ACTIVE_STATUSES },
    supplierOrderId: { $ne: '' }
  })
    .sort({ lastSyncedAt: 1 })
    .limit(limit);

  const results = [];
  for (const supplierOrder of active) {
    results.push(await syncSupplierOrderStatus(supplierOrder._id));
  }
  return { checked: active.length, results };
};

/**
 * Attempts supplier-side cancellation. Returns requiresManual=true when a
 * supplier has started fulfilment or does not support cancellation APIs.
 */
export const cancelSupplierOrdersForOrder = async (order, reason) => {
  const supplierOrders = await SupplierOrder.find({ order: order._id });
  let cancelled = 0;
  let requiresManual = false;
  const failures = [];

  for (const supplierOrder of supplierOrders) {
    if (TERMINAL_STATUSES.includes(supplierOrder.status)) continue;
    if (
      [
        SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION,
        SUPPLIER_ORDER_STATUS.FAILED,
        SUPPLIER_ORDER_STATUS.ACTION_REQUIRED
      ].includes(supplierOrder.status)
    ) {
      supplierOrder.status = SUPPLIER_ORDER_STATUS.CANCELLED;
      supplierOrder.cancelledAt = new Date();
      addHistory(supplierOrder, SUPPLIER_ORDER_STATUS.CANCELLED, {
        note: `Cancelled before submission: ${reason}`,
        source: 'system'
      });
      await supplierOrder.save();
      cancelled += 1;
      continue;
    }

    const supplier = await Supplier.findById(supplierOrder.supplier).select('+credentials');
    if (!supplier?.capabilities?.cancellation || !supplierOrder.supplierOrderId) {
      requiresManual = true;
      failures.push({
        supplierOrderId: String(supplierOrder._id),
        message: supplier?.capabilities?.cancellation
          ? 'No supplier order id available'
          : 'Supplier does not support API cancellation'
      });
      continue;
    }

    try {
      const adapter = createSupplierAdapter(supplier);
      await adapter.cancelSupplierOrder(supplierOrder.supplierOrderId, reason);
      supplierOrder.status = SUPPLIER_ORDER_STATUS.CANCELLED;
      supplierOrder.cancelledAt = new Date();
      addHistory(supplierOrder, SUPPLIER_ORDER_STATUS.CANCELLED, {
        note: reason,
        source: 'system'
      });
      await supplierOrder.save();
      cancelled += 1;
    } catch (error) {
      requiresManual = true;
      failures.push({ supplierOrderId: String(supplierOrder._id), message: error.message });
      await createSyncLog({
        supplier: supplier._id,
        type: 'order_submit',
        status: 'failed',
        message: `Supplier cancellation failed: ${error.message}`,
        triggeredBy: 'manual'
      });
    }
  }

  return { checked: supplierOrders.length, cancelled, requiresManual, failures };
};

export const cancelSupplierOrderAdmin = async (supplierOrderId, reason) => {
  const supplierOrder = await findSupplierOrder(supplierOrderId);
  if (TERMINAL_STATUSES.includes(supplierOrder.status)) return supplierOrder;

  if (
    [
      SUPPLIER_ORDER_STATUS.PENDING_SUBMISSION,
      SUPPLIER_ORDER_STATUS.FAILED,
      SUPPLIER_ORDER_STATUS.ACTION_REQUIRED
    ].includes(supplierOrder.status)
  ) {
    supplierOrder.status = SUPPLIER_ORDER_STATUS.CANCELLED;
    supplierOrder.cancelledAt = new Date();
    addHistory(supplierOrder, SUPPLIER_ORDER_STATUS.CANCELLED, {
      note: reason || 'Cancelled by admin before submission',
      source: 'admin'
    });
    await supplierOrder.save();
    await refreshOrderFulfilmentState(supplierOrder.order._id || supplierOrder.order);
    return supplierOrder;
  }

  const supplier = await Supplier.findById(supplierOrder.supplier).select('+credentials');
  if (!supplier?.capabilities?.cancellation || !supplierOrder.supplierOrderId) {
    throw new ApiError(
      409,
      'SUPPLIER_UNSUPPORTED',
      'This supplier does not support API cancellation. Cancel the order in the supplier portal and update tracking manually.'
    );
  }

  const adapter = createSupplierAdapter(supplier);
  try {
    await adapter.cancelSupplierOrder(supplierOrder.supplierOrderId, reason || 'Cancelled by admin');
  } catch (error) {
    throw new ApiError(
      409,
      ERROR_CODES.SUPPLIER_ERROR,
      `Supplier cancellation failed: ${error.message}`
    );
  }
  supplierOrder.status = SUPPLIER_ORDER_STATUS.CANCELLED;
  supplierOrder.cancelledAt = new Date();
  addHistory(supplierOrder, SUPPLIER_ORDER_STATUS.CANCELLED, {
    note: reason || 'Cancelled by admin',
    source: 'admin'
  });
  await supplierOrder.save();
  await refreshOrderFulfilmentState(supplierOrder.order._id || supplierOrder.order);
  return findSupplierOrder(supplierOrder._id);
};

export const listSupplierOrders = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.supplierId) filter.supplier = query.supplierId;
  if (query.orderId) filter.order = query.orderId;
  if (query.needsAttention === 'true') filter.status = { $in: ['failed', 'action_required'] };
  if (query.q) {
    const regex = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ orderNumber: regex }, { supplierOrderId: regex }, { lastError: regex }];
  }

  const [supplierOrders, total] = await Promise.all([
    SupplierOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'supplier', select: 'name code isMock isActive' })
      .populate({ path: 'order', select: 'orderNumber status total user' }),
    SupplierOrder.countDocuments(filter)
  ]);

  return { supplierOrders, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getSupplierOrder = async (id) => findSupplierOrder(id);

export const getSupplierOrderStats = async () => {
  const rows = await SupplierOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  return rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
};
