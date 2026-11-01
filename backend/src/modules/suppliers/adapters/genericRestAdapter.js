import { BaseSupplierAdapter } from './baseAdapter.js';
import { SupplierAdapterError } from './errors.js';
import { env } from '../../../config/env.js';
import { assertSafeSupplierUrl } from '../../../utils/ssrf.js';
import { NORMALIZED_SUPPLIER_STATUS } from '../../../constants/supplier.js';

const NORMALIZED_STATUS_VALUES = Object.values(NORMALIZED_SUPPLIER_STATUS);

const getByPath = (source, path) => {
  if (!path) return undefined;
  return String(path)
    .split('.')
    .reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), source);
};

const mapFields = (source, fieldMap) => {
  const output = {};
  for (const [target, sourcePath] of Object.entries(fieldMap)) {
    const value = getByPath(source, sourcePath);
    if (value !== undefined) output[target] = value;
  }
  return output;
};

const buildFieldMap = (targets, overrides = {}) =>
  Object.fromEntries(targets.map((target) => [target, overrides[target] || target]));

const PRODUCT_FIELDS = [
  'supplierProductId',
  'supplierSku',
  'title',
  'description',
  'category',
  'brand',
  'images',
  'attributes',
  'currency',
  'variants',
  'updatedAt'
];

const VARIANT_FIELDS = [
  'supplierVariantId',
  'sku',
  'name',
  'attributes',
  'supplierCost',
  'mrp',
  'stock'
];

const INVENTORY_FIELDS = ['supplierProductId', 'supplierVariantId', 'sku', 'stock', 'updatedAt'];

const normalizeImages = (images) => {
  if (!Array.isArray(images)) return [];
  return images
    .map((item) => (typeof item === 'string' ? { url: item } : item))
    .filter((item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url))
    .map((item) => ({ url: item.url, alt: item.alt || '', isPrimary: Boolean(item.isPrimary) }));
};

const resolveItems = (data, configuredPath) => {
  if (Array.isArray(data)) return data;
  if (configuredPath) {
    const value = getByPath(data, configuredPath);
    if (Array.isArray(value)) return value;
  }
  for (const candidate of ['items', 'products', 'data', 'data.items', 'data.products', 'results']) {
    const value = getByPath(data, candidate);
    if (Array.isArray(value)) return value;
  }
  return [];
};

/**
 * Configurable REST adapter for suppliers that provide documented HTTP APIs.
 * Endpoint paths, auth style, pagination and field mappings MUST come from the
 * supplier's official documentation. This adapter never guesses endpoints.
 *
 * Example supplier.config:
 * {
 *   "endpoints": {
 *     "testConnection": "/api/v1/ping",
 *     "products": "/api/v1/catalogue/products",
 *     "inventory": "/api/v1/catalogue/stock",
 *     "orders": "/api/v1/orders",
 *     "orderStatus": "/api/v1/orders/:supplierOrderId",
 *     "tracking": "/api/v1/orders/:supplierOrderId/tracking",
 *     "cancel": "/api/v1/orders/:supplierOrderId/cancel"
 *   },
 *   "auth": { "type": "header", "headerName": "X-API-Key", "credentialField": "apiKey" },
 *   "pagination": { "type": "page", "pageParam": "page", "limitParam": "limit",
 *                   "pageSize": 100, "itemsPath": "data.products" },
 *   "fieldMaps": {
 *     "product": { "supplierProductId": "id", "title": "name", "category": "category.name" },
 *     "variant": { "supplierCost": "cost" }
 *   },
 *   "response": { "orderIdPath": "data.id", "statusPath": "data.status" },
 *   "statusMap": { "new": "accepted", "in_transit": "shipped" }
 * }
 */
export class GenericRestSupplierAdapter extends BaseSupplierAdapter {
  constructor({ supplier, credentials }) {
    super({ supplier, credentials });
    this.config = supplier?.config && typeof supplier.config === 'object' ? supplier.config : {};
    this.isMock = false;
  }

  get baseUrl() {
    if (!this.supplier?.baseUrl) {
      throw new SupplierAdapterError('Supplier base URL is not configured', { retryable: false });
    }
    return this.supplier.baseUrl.endsWith('/') ? this.supplier.baseUrl : `${this.supplier.baseUrl}/`;
  }

  requireEndpoint(key, label) {
    const endpoint = this.config.endpoints?.[key];
    if (!endpoint || typeof endpoint !== 'string') {
      throw new SupplierAdapterError(
        `No documented endpoint configured for ${label}. Add config.endpoints.${key} using the supplier's official API documentation.`,
        { retryable: false }
      );
    }
    return endpoint;
  }

  applyAuth(url, headers) {
    const auth = this.config.auth || { type: 'bearer', credentialField: 'apiKey' };
    if (auth.type === 'none') return;

    const field = auth.credentialField || 'apiKey';
    const token = this.credentials?.[field];
    if (!token) {
      throw new SupplierAdapterError(`Missing supplier credential "${field}"`, { retryable: false });
    }

    if (auth.type === 'bearer') headers.Authorization = `Bearer ${token}`;
    else if (auth.type === 'header') headers[auth.headerName || 'X-API-Key'] = String(token);
    else if (auth.type === 'query') url.searchParams.set(auth.queryParam || 'api_key', String(token));
    else throw new SupplierAdapterError(`Unsupported supplier auth type "${auth.type}"`, { retryable: false });
  }

  async request(pathname, { method = 'GET', query = {}, body, idempotencyKey } = {}) {
    const url = new URL(pathname, this.baseUrl);
    const baseHost = new URL(this.baseUrl).hostname.toLowerCase();

    if (url.protocol !== 'https:') {
      throw new SupplierAdapterError('Supplier request blocked: HTTPS is required', { retryable: false });
    }
    if (url.hostname.toLowerCase() !== baseHost) {
      throw new SupplierAdapterError('Supplier request blocked: endpoint host must match the approved base URL', {
        retryable: false
      });
    }

    assertSafeSupplierUrl(url.toString(), this.supplier.allowedHosts || []);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    this.applyAuth(url, headers);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.SUPPLIER_HTTP_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error'
      });
    } catch (error) {
      const isTimeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      throw new SupplierAdapterError(
        isTimeout ? 'Supplier request timed out' : `Supplier request failed: ${error?.message || 'network error'}`,
        { retryable: true }
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 500) };
      }
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const message =
        getByPath(data, 'error.message') || getByPath(data, 'message') || `Supplier responded with HTTP ${response.status}`;
      throw new SupplierAdapterError(String(message).slice(0, 300), {
        retryable,
        statusCode: response.status
      });
    }

    return { data, statusCode: response.status };
  }

  mapStatus(rawStatus) {
    const key = String(rawStatus || '').toLowerCase();
    const mapped = (this.config.statusMap || {})[key] || (this.config.statusMap || {})[String(rawStatus)] || key;
    return NORMALIZED_STATUS_VALUES.includes(mapped) ? mapped : NORMALIZED_SUPPLIER_STATUS.UNKNOWN;
  }

  async testConnection() {
    const endpoint = this.config.endpoints?.testConnection || this.config.endpoints?.products;
    if (!endpoint) {
      throw new SupplierAdapterError(
        'Configure config.endpoints.testConnection (or products) from the supplier documentation before testing.',
        { retryable: false }
      );
    }

    const { data, statusCode } = await this.request(endpoint, { method: 'GET' });
    return {
      ok: true,
      mode: 'live',
      isMock: false,
      statusCode,
      message: 'Supplier API reachable',
      responseKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 10) : []
    };
  }

  async fetchProducts({ page = 1, limit = 50, cursor = null } = {}) {
    this.assertCapability('catalogue', 'product catalogue');
    const endpoint = this.requireEndpoint('products', 'product catalogue');
    const pagination = {
      type: 'page',
      pageParam: 'page',
      cursorParam: 'cursor',
      limitParam: 'limit',
      pageSize: 100,
      itemsPath: null,
      nextCursorPath: null,
      ...(this.config.pagination || {})
    };

    const query = { [pagination.limitParam]: limit };
    if (pagination.type === 'cursor') {
      if (cursor) query[pagination.cursorParam] = cursor;
    } else {
      query[pagination.pageParam] = page;
    }

    const { data } = await this.request(endpoint, { method: 'GET', query });
    const items = resolveItems(data, pagination.itemsPath);
    const productMap = buildFieldMap(PRODUCT_FIELDS, this.config.fieldMaps?.product);
    const variantMap = buildFieldMap(VARIANT_FIELDS, this.config.fieldMaps?.variant);

    const products = items.map((item) => {
      const mapped = mapFields(item, productMap);
      mapped.currency = mapped.currency || 'INR';
      mapped.images = normalizeImages(mapped.images);
      mapped.variants = Array.isArray(mapped.variants)
        ? mapped.variants.map((variant) => {
            const mappedVariant = mapFields(variant, variantMap);
            if (mappedVariant.supplierVariantId === undefined) mappedVariant.supplierVariantId = mappedVariant.sku;
            if (mappedVariant.name === undefined) mappedVariant.name = mappedVariant.sku;
            if (mappedVariant.attributes === undefined) mappedVariant.attributes = {};
            return mappedVariant;
          })
        : [];
      mapped.attributes = mapped.attributes || {};
      return mapped;
    });

    const nextCursor = pagination.nextCursorPath ? getByPath(data, pagination.nextCursorPath) : null;
    const hasMore =
      pagination.type === 'cursor' ? Boolean(nextCursor) : products.length >= Number(limit);

    return {
      products,
      page,
      limit,
      total: getByPath(data, 'total') ?? null,
      hasMore,
      nextPage: hasMore && pagination.type !== 'cursor' ? Number(page) + 1 : null,
      nextCursor: nextCursor || null,
      mock: false
    };
  }

  async fetchInventory() {
    this.assertCapability('inventory', 'inventory');
    const endpoint = this.requireEndpoint('inventory', 'inventory');
    const { data } = await this.request(endpoint, { method: 'GET' });

    const itemsPath = this.config.pagination?.inventoryItemsPath || this.config.pagination?.itemsPath || null;
    const rawItems = resolveItems(data, itemsPath);
    const inventoryMap = buildFieldMap(INVENTORY_FIELDS, this.config.fieldMaps?.inventory);

    return {
      items: rawItems.map((item) => mapFields(item, inventoryMap)),
      updatedAt: getByPath(data, 'updatedAt') || new Date().toISOString(),
      mock: false
    };
  }

  async createSupplierOrder(payload = {}) {
    this.assertCapability('orderPlacement', 'order placement');
    const endpoint = this.requireEndpoint('orders', 'order placement');
    const method = this.config.methods?.createOrder || 'POST';

    const { data } = await this.request(endpoint, {
      method,
      body: payload,
      idempotencyKey: payload.idempotencyKey
    });

    const orderId =
      getByPath(data, this.config.response?.orderIdPath || 'supplierOrderId') ??
      getByPath(data, 'id') ??
      getByPath(data, 'data.id');

    if (!orderId) {
      throw new SupplierAdapterError('Supplier did not return an order identifier', { retryable: false });
    }

    const rawStatus = getByPath(data, this.config.response?.statusPath || 'status');

    return {
      supplierOrderId: String(orderId),
      status: rawStatus ?? 'submitted',
      normalizedStatus: this.mapStatus(rawStatus ?? 'submitted'),
      tracking: null,
      mock: false,
      rawResponse: data
    };
  }

  async getOrderStatus(supplierOrderId) {
    this.assertCapability('orderStatus', 'order status');
    const template = this.requireEndpoint('orderStatus', 'order status');
    const endpoint = template.replace(':supplierOrderId', encodeURIComponent(supplierOrderId)).replace(':id', encodeURIComponent(supplierOrderId));

    const { data } = await this.request(endpoint, { method: 'GET' });
    const rawStatus = getByPath(data, this.config.response?.statusPath || 'status');

    return {
      status: rawStatus ?? 'unknown',
      normalizedStatus: this.mapStatus(rawStatus),
      updatedAt: getByPath(data, this.config.response?.updatedAtPath || 'updatedAt') || new Date().toISOString(),
      mock: false
    };
  }

  async getTrackingDetails(supplierOrderId) {
    this.assertCapability('tracking', 'tracking');
    const template = this.requireEndpoint('tracking', 'tracking');
    const endpoint = template.replace(':supplierOrderId', encodeURIComponent(supplierOrderId)).replace(':id', encodeURIComponent(supplierOrderId));

    const { data } = await this.request(endpoint, { method: 'GET' });
    const mapping = {
      courier: 'courier',
      trackingNumber: 'trackingNumber',
      trackingUrl: 'trackingUrl',
      updatedAt: 'updatedAt',
      ...(this.config.response?.tracking || {})
    };

    const tracking = {
      courier: getByPath(data, mapping.courier) || '',
      trackingNumber: getByPath(data, mapping.trackingNumber) || '',
      trackingUrl: getByPath(data, mapping.trackingUrl) || '',
      status: this.mapStatus(getByPath(data, this.config.response?.statusPath || 'status')),
      updatedAt: getByPath(data, mapping.updatedAt) || new Date().toISOString(),
      mock: false
    };

    if (!tracking.trackingNumber) return null;
    return tracking;
  }

  async cancelSupplierOrder(supplierOrderId, reason = '') {
    this.assertCapability('cancellation', 'cancellation');
    const template = this.requireEndpoint('cancel', 'cancellation');
    const endpoint = template.replace(':supplierOrderId', encodeURIComponent(supplierOrderId)).replace(':id', encodeURIComponent(supplierOrderId));
    const method = this.config.methods?.cancel || 'POST';

    await this.request(endpoint, { method, body: method === 'GET' ? undefined : { reason } });
    return { cancelled: true, alreadyCancelled: false, mock: false };
  }
}
