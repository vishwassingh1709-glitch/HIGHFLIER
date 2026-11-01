import { asyncHandler, sendSuccess } from '../../utils/http.js';
import * as adminService from './admin.service.js';

export const getDashboard = asyncHandler(async (_req, res) =>
  sendSuccess(res, await adminService.getDashboard())
);

export const listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers(req.query);
  return sendSuccess(res, result.users, { meta: result.meta });
});

export const getUser = asyncHandler(async (req, res) =>
  sendSuccess(res, await adminService.getUser(req.params.id))
);

export const updateUser = asyncHandler(async (req, res) =>
  sendSuccess(res, await adminService.updateUser(req.params.id, req.body, { req }))
);

export const revokeUserSessions = asyncHandler(async (req, res) =>
  sendSuccess(res, await adminService.revokeUserSessions(req.params.id, { req }))
);

export const getSalesReport = asyncHandler(async (req, res) =>
  sendSuccess(res, await adminService.getSalesReport(req.query))
);

export const getTopProducts = asyncHandler(async (req, res) =>
  sendSuccess(res, await adminService.getTopProducts(req.query))
);

export const getLowStock = asyncHandler(async (req, res) =>
  sendSuccess(res, await adminService.getLowStockReport(req.query))
);

export const getSupplierPerformance = asyncHandler(async (_req, res) =>
  sendSuccess(res, await adminService.getSupplierPerformance())
);

export const listAuditLogs = asyncHandler(async (req, res) => {
  const result = await adminService.listAuditLogs(req.query);
  return sendSuccess(res, result.logs, { meta: result.meta });
});

export const listWebhookEvents = asyncHandler(async (req, res) => {
  const result = await adminService.listWebhookEvents(req.query);
  return sendSuccess(res, result.events, { meta: result.meta });
});

export const listSyncLogs = asyncHandler(async (req, res) => {
  const result = await adminService.listSyncLogs(req.query);
  return sendSuccess(res, result.logs, { meta: result.meta });
});
