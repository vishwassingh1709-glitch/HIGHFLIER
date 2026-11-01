import { asyncHandler, sendSuccess } from '../../utils/http.js';
import {
  cancelSupplierOrderAdmin,
  getSupplierOrder,
  getSupplierOrderStats,
  listSupplierOrders,
  retryDueSupplierOrders,
  submitSupplierOrder,
  syncSupplierOrderStatus
} from './supplierOrder.service.js';

export const list = asyncHandler(async (req, res) => {
  const result = await listSupplierOrders(req.query);
  return sendSuccess(res, result.supplierOrders, { meta: result.meta });
});

export const get = asyncHandler(async (req, res) => sendSuccess(res, await getSupplierOrder(req.params.id)));

export const retry = asyncHandler(async (req, res) =>
  sendSuccess(res, await submitSupplierOrder(req.params.id, { actor: req.user._id }))
);

export const syncStatus = asyncHandler(async (req, res) =>
  sendSuccess(res, await syncSupplierOrderStatus(req.params.id, { actor: req.user._id, requestId: req.id }))
);

export const cancel = asyncHandler(async (req, res) =>
  sendSuccess(res, await cancelSupplierOrderAdmin(req.params.id, req.body.reason))
);

export const retryAllDue = asyncHandler(async (_req, res) =>
  sendSuccess(res, await retryDueSupplierOrders())
);

export const stats = asyncHandler(async (_req, res) => sendSuccess(res, await getSupplierOrderStats()));
