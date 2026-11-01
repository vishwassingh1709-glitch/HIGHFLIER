import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { DEFAULT_SUPPLIER_CAPABILITIES, SYNC_LOG_STATUS } from '../../constants/supplier.js';
import { Supplier } from '../../models/Supplier.js';
import { SyncLog } from '../../models/SyncLog.js';
import { encryptJson } from '../../utils/crypto.js';
import { assertSafeSupplierUrl, normalizeAllowedHosts } from '../../utils/ssrf.js';
import { escapeRegex } from '../../utils/slugify.js';
import { parsePagination, buildPaginationMeta } from '../../utils/http.js';
import { createSupplierAdapter } from './adapters/index.js';
import { MOCK_SUPPLIER_CAPABILITIES } from './adapters/mockAdapter.js';
import { createSyncLog } from './syncLog.service.js';

const getSupplierDoc = async (id, { withCredentials = false } = {}) => {
  let query = Supplier.findById(id);
  if (withCredentials) query = query.select('+credentials');
  const supplier = await query;
  if (!supplier) throw ApiError.notFound('Supplier');
  return supplier;
};

const applyCredentials = (supplier, credentials) => {
  supplier.credentials = encryptJson(credentials);
  supplier.credentialsMeta = {
    configured: true,
    keys: Object.keys(credentials).sort(),
    updatedAt: new Date()
  };
};

const validateSupplierUrl = (baseUrl, allowedHosts = []) => {
  if (!baseUrl) return;
  assertSafeSupplierUrl(baseUrl, normalizeAllowedHosts(allowedHosts));
};

const resolveCapabilities = (adapterType, requested = {}, existing = null) => {
  if (adapterType === 'mock') {
    return { ...DEFAULT_SUPPLIER_CAPABILITIES, ...MOCK_SUPPLIER_CAPABILITIES };
  }
  const base = existing
    ? existing.capabilities?.toObject
      ? existing.capabilities.toObject()
      : existing.capabilities
    : DEFAULT_SUPPLIER_CAPABILITIES;
  return { ...base, ...requested };
};

export const createSupplier = async (payload, actorId = null) => {
  const code = payload.code.toLowerCase();
  const duplicate = await Supplier.exists({ code });
  if (duplicate) throw ApiError.conflict(`Supplier code "${code}" is already in use`);

  if (payload.adapterType === 'generic_rest') {
    validateSupplierUrl(payload.baseUrl, payload.allowedHosts);
  } else if (payload.baseUrl) {
    // Mock adapters never contact the URL, but keep stored values well-formed.
    try {
      new URL(payload.baseUrl);
    } catch {
      throw ApiError.badRequest('baseUrl must be a valid URL');
    }
  }

  const supplier = new Supplier({
    name: payload.name,
    code,
    description: payload.description || '',
    adapterType: payload.adapterType,
    baseUrl: payload.baseUrl || '',
    allowedHosts: normalizeAllowedHosts(payload.allowedHosts || []),
    config: payload.config || {},
    capabilities: resolveCapabilities(payload.adapterType, payload.capabilities || {}),
    markupRule: payload.markupRule || { type: 'percent', value: 35, minMarginPercent: 0 },
    isActive: payload.isActive !== false,
    isMock: payload.adapterType === 'mock',
    createdBy: actorId
  });

  if (payload.credentials) applyCredentials(supplier, payload.credentials);

  await supplier.save();
  return supplier;
};

export const listSuppliers = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.adapterType) filter.adapterType = query.adapterType;
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: regex }, { code: regex }];
  }

  const [suppliers, total] = await Promise.all([
    Supplier.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Supplier.countDocuments(filter)
  ]);

  return { suppliers, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getSupplier = async (id) => getSupplierDoc(id);

export const updateSupplier = async (id, payload) => {
  const supplier = await getSupplierDoc(id);

  if (payload.baseUrl !== undefined) {
    if (supplier.adapterType === 'generic_rest') {
      validateSupplierUrl(payload.baseUrl, payload.allowedHosts || supplier.allowedHosts);
    } else {
      try {
        new URL(payload.baseUrl);
      } catch {
        throw ApiError.badRequest('baseUrl must be a valid URL');
      }
    }
    supplier.baseUrl = payload.baseUrl;
  }

  if (payload.allowedHosts !== undefined) {
    supplier.allowedHosts = normalizeAllowedHosts(payload.allowedHosts);
    if (supplier.adapterType === 'generic_rest' && supplier.baseUrl) {
      validateSupplierUrl(supplier.baseUrl, supplier.allowedHosts);
    }
  }

  if (payload.name !== undefined) supplier.name = payload.name;
  if (payload.description !== undefined) supplier.description = payload.description;
  if (payload.config !== undefined) supplier.config = payload.config;
  if (payload.isActive !== undefined) supplier.isActive = payload.isActive;
  if (payload.capabilities !== undefined) {
    supplier.capabilities = resolveCapabilities(supplier.adapterType, payload.capabilities, supplier);
  }
  if (payload.markupRule !== undefined) {
    supplier.markupRule = {
      ...(supplier.markupRule?.toObject ? supplier.markupRule.toObject() : supplier.markupRule || {}),
      ...payload.markupRule
    };
  }

  await supplier.save();
  return supplier;
};

export const deactivateSupplier = async (id) => {
  const supplier = await getSupplierDoc(id);
  supplier.isActive = false;
  await supplier.save();
  return { message: 'Supplier deactivated. Existing products and orders are preserved.', supplier };
};

export const setCredentials = async (id, credentials) => {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw ApiError.notFound('Supplier');
  applyCredentials(supplier, credentials);
  await supplier.save();
  return supplier.credentialsMeta;
};

export const removeCredentials = async (id) => {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw ApiError.notFound('Supplier');
  await Supplier.updateOne(
    { _id: id },
    { $unset: { credentials: 1 }, $set: { 'credentialsMeta.configured': false, 'credentialsMeta.keys': [], 'credentialsMeta.updatedAt': new Date() } }
  );
  return { message: 'Supplier credentials removed' };
};

export const testSupplierConnection = async (id, actorId = null, requestId = '') => {
  const supplier = await getSupplierDoc(id, { withCredentials: true });
  const startedAt = new Date();
  const adapter = createSupplierAdapter(supplier);

  try {
    const result = await adapter.testConnection();
    supplier.lastConnectionTest = {
      at: new Date(),
      ok: true,
      message: String(result.message || 'Connection successful').slice(0, 500),
      mode: result.mode || (supplier.isMock ? 'mock' : 'live')
    };
    await supplier.save();
    await createSyncLog({
      supplier: supplier._id,
      type: 'connection_test',
      status: SYNC_LOG_STATUS.SUCCESS,
      message: result.message,
      triggeredBy: 'manual',
      triggeredByUser: actorId,
      requestId,
      startedAt,
      finishedAt: new Date()
    });
    return result;
  } catch (error) {
    supplier.lastConnectionTest = {
      at: new Date(),
      ok: false,
      message: String(error.message || 'Connection failed').slice(0, 500),
      mode: supplier.isMock ? 'mock' : 'live'
    };
    await supplier.save();
    await createSyncLog({
      supplier: supplier._id,
      type: 'connection_test',
      status: SYNC_LOG_STATUS.FAILED,
      message: 'Connection test failed',
      errors: [{ message: error.message }],
      triggeredBy: 'manual',
      triggeredByUser: actorId,
      requestId,
      startedAt,
      finishedAt: new Date()
    });
    throw new ApiError(502, ERROR_CODES.SUPPLIER_ERROR, `Supplier connection test failed: ${error.message}`);
  }
};

export const getSupplierCapabilities = async (id) => {
  const supplier = await getSupplierDoc(id);
  return {
    supplierId: supplier._id,
    adapterType: supplier.adapterType,
    isMock: supplier.isMock,
    capabilities: supplier.capabilities
  };
};

export const listSupplierLogs = async (id, query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { supplier: id };
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;

  const [logs, total] = await Promise.all([
    SyncLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SyncLog.countDocuments(filter)
  ]);

  return { logs, meta: buildPaginationMeta({ page, limit, total }) };
};

export const updateMarkupRule = async (id, markupRule) => {
  const supplier = await getSupplierDoc(id);
  supplier.markupRule = {
    ...(supplier.markupRule?.toObject ? supplier.markupRule.toObject() : supplier.markupRule || {}),
    ...markupRule
  };
  await supplier.save();
  return supplier;
};

/**
 * Loads a supplier with decrypted credentials and returns a ready adapter.
 * Used by catalogue/inventory sync and supplier order services.
 */
export const getSupplierAdapter = async (id, { requireActive = true } = {}) => {
  const supplier = await getSupplierDoc(id, { withCredentials: true });
  if (requireActive && !supplier.isActive) {
    throw ApiError.badRequest('Supplier is inactive');
  }
  const adapter = createSupplierAdapter(supplier);
  return { supplier, adapter };
};

export const listActiveSuppliers = async ({ withCredentials = false } = {}) => {
  let query = Supplier.find({ isActive: true });
  if (withCredentials) query = query.select('+credentials');
  return query;
};
