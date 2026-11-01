import { asyncHandler, sendCreated, sendSuccess } from '../../utils/http.js';
import { normalizeIdempotencyKey } from '../../utils/idempotency.js';
import * as ordersService from './orders.service.js';

export const checkout = asyncHandler(async (req, res) => {
  const idempotencyKey = normalizeIdempotencyKey(
    req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || req.body.idempotencyKey
  );
  const result = await ordersService.createOrder(req.user, req.body, {
    idempotencyKey,
    requestId: req.id
  });
  return sendCreated(res, result);
});

export const listMyOrders = asyncHandler(async (req, res) => {
  const result = await ordersService.listMyOrders(req.user, req.query);
  return sendSuccess(res, result.orders, { meta: result.meta });
});

export const getMyOrder = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.getMyOrder(req.user, req.params.id))
);

export const cancelMyOrder = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.cancelMyOrder(req.user, req.params.id, req.body.reason))
);

export const requestReturn = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.requestReturn(req.user, req.params.id, req.body))
);

export const listOrdersAdmin = asyncHandler(async (req, res) => {
  const result = await ordersService.listOrdersAdmin(req.query);
  return sendSuccess(res, result.orders, { meta: result.meta });
});

export const getOrderAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.getOrderAdmin(req.params.id))
);

export const updateStatusAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.adminUpdateStatus(req.params.id, req.body, req.user._id))
);

export const updateTrackingAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.adminUpdateTracking(req.params.id, req.body))
);

export const addNoteAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.adminAddNote(req.params.id, req.body.adminNote))
);

export const refundAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.adminRefundOrder(req.params.id, req.body, req.user._id))
);

export const resolveReturnAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, await ordersService.adminResolveReturn(req.params.id, req.body, req.user._id))
);
