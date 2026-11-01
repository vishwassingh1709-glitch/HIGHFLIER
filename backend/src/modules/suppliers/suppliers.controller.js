import { asyncHandler, sendCreated, sendSuccess } from '../../utils/http.js';
import * as suppliersService from './suppliers.service.js';
import { syncCatalogue } from './catalogueSync.service.js';
import { markStaleProducts, syncInventory } from './inventorySync.service.js';
import { repriceSupplierProducts } from '../products/pricing.service.js';

export const createSupplier = asyncHandler(async (req, res) => {
  const supplier = await suppliersService.createSupplier(req.body, req.user._id);
  sendCreated(res, { supplier });
});

export const listSuppliers = asyncHandler(async (req, res) => {
  const { suppliers, meta } = await suppliersService.listSuppliers(req.query);
  sendSuccess(res, { suppliers }, { meta });
});

export const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await suppliersService.getSupplier(req.params.id);
  sendSuccess(res, { supplier });
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await suppliersService.updateSupplier(req.params.id, req.body);
  sendSuccess(res, { supplier });
});

export const deactivateSupplier = asyncHandler(async (req, res) => {
  const result = await suppliersService.deactivateSupplier(req.params.id);
  sendSuccess(res, result);
});

export const setCredentials = asyncHandler(async (req, res) => {
  const credentialsMeta = await suppliersService.setCredentials(req.params.id, req.body.credentials);
  sendSuccess(res, { credentialsMeta, message: 'Supplier credentials stored encrypted' });
});

export const removeCredentials = asyncHandler(async (req, res) => {
  const result = await suppliersService.removeCredentials(req.params.id);
  sendSuccess(res, result);
});

export const testConnection = asyncHandler(async (req, res) => {
  const result = await suppliersService.testSupplierConnection(req.params.id, req.user._id, req.id);
  sendSuccess(res, { connection: result });
});

export const getCapabilities = asyncHandler(async (req, res) => {
  const result = await suppliersService.getSupplierCapabilities(req.params.id);
  sendSuccess(res, result);
});

export const listLogs = asyncHandler(async (req, res) => {
  const { logs, meta } = await suppliersService.listSupplierLogs(req.params.id, req.query);
  sendSuccess(res, { logs }, { meta });
});

export const updateMarkup = asyncHandler(async (req, res) => {
  const supplier = await suppliersService.updateMarkupRule(req.params.id, req.body);
  const repricing = await repriceSupplierProducts(supplier);
  sendSuccess(res, { supplier, repricing });
});

export const triggerCatalogueSync = asyncHandler(async (req, res) => {
  const result = await syncCatalogue(req.params.id, {
    triggeredBy: 'manual',
    userId: req.user._id,
    requestId: req.id,
    maxPages: req.body.maxPages
  });
  sendSuccess(res, result);
});

export const triggerInventorySync = asyncHandler(async (req, res) => {
  const result = await syncInventory(req.params.id, {
    triggeredBy: 'manual',
    userId: req.user._id,
    requestId: req.id,
    markMissingUnavailable: req.body.markMissingUnavailable
  });
  sendSuccess(res, result);
});

export const triggerStaleScan = asyncHandler(async (req, res) => {
  const result = await markStaleProducts(req.params.id, {
    hours: req.body.hours,
    triggeredBy: 'manual',
    userId: req.user._id,
    requestId: req.id
  });
  sendSuccess(res, result);
});
