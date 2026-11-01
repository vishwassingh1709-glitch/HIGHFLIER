import { BaseSupplierAdapter } from './baseAdapter.js';
import { SupplierAdapterError } from './errors.js';
import { MOCK_CATALOGUE } from './mockCatalogue.js';
import { NORMALIZED_SUPPLIER_STATUS } from '../../../constants/supplier.js';

export const MOCK_SUPPLIER_CAPABILITIES = Object.freeze({
  catalogue: true,
  pricing: true,
  inventory: true,
  orderPlacement: true,
  orderStatus: true,
  tracking: true,
  cancellation: true,
  returns: true,
  cod: true,
  serviceability: true
});

const DEFAULT_TIMELINE = Object.freeze({ processing: 60, shipped: 120, delivered: 180 });
const orderStore = new Map();
const idempotencyIndex = new Map();
let orderSequence = 1000;

const clone = (value) => structuredClone(value);

/**
 * MOCK supplier adapter. It never contacts an external service and every
 * response is explicitly flagged `mock: true`. It exists so the platform can be
 * developed and tested end-to-end without pretending a real supplier fulfilled
 * anything. Replace it with a verified live adapter before launch.
 */
export class MockSupplierAdapter extends BaseSupplierAdapter {
  constructor({ supplier, credentials }) {
    super({ supplier, credentials });
    const stored = supplier?.capabilities?.toObject
      ? supplier.capabilities.toObject()
      : supplier?.capabilities;
    this.capabilities = stored && Object.keys(stored).length ? stored : { ...MOCK_SUPPLIER_CAPABILITIES };
    this.isMock = true;
  }

  get timeline() {
    const config = this.supplier?.config?.mockTimelineSeconds || {};
    return {
      processing: Number(config.processing ?? DEFAULT_TIMELINE.processing),
      shipped: Number(config.shipped ?? DEFAULT_TIMELINE.shipped),
      delivered: Number(config.delivered ?? DEFAULT_TIMELINE.delivered)
    };
  }

  getOrderRecord(supplierOrderId) {
    const record = orderStore.get(String(supplierOrderId));
    if (!record) {
      throw new SupplierAdapterError(
        `Mock supplier order "${supplierOrderId}" was not found in this process. Mock orders do not survive a restart.`,
        { retryable: false }
      );
    }
    return record;
  }

  async testConnection() {
    return {
      ok: true,
      mode: 'mock',
      isMock: true,
      message: 'Mock adapter connected locally. No external supplier API was contacted.'
    };
  }

  async fetchProducts({ page = 1, limit = 50 } = {}) {
    this.assertCapability('catalogue', 'product catalogue');
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const start = (safePage - 1) * safeLimit;
    const products = MOCK_CATALOGUE.slice(start, start + safeLimit).map(clone);
    const hasMore = start + safeLimit < MOCK_CATALOGUE.length;

    return {
      products,
      page: safePage,
      limit: safeLimit,
      total: MOCK_CATALOGUE.length,
      hasMore,
      nextPage: hasMore ? safePage + 1 : null,
      nextCursor: null,
      mock: true
    };
  }

  async fetchInventory() {
    this.assertCapability('inventory', 'inventory');
    const items = MOCK_CATALOGUE.flatMap((product) =>
      product.variants.map((variant) => ({
        supplierProductId: product.supplierProductId,
        supplierSku: product.supplierSku,
        supplierVariantId: variant.supplierVariantId,
        sku: variant.sku,
        stock: variant.stock
      }))
    );
    return { items, updatedAt: new Date().toISOString(), mock: true };
  }

  async createSupplierOrder(payload = {}) {
    this.assertCapability('orderPlacement', 'order placement');
    if (!payload.idempotencyKey) {
      throw new SupplierAdapterError('idempotencyKey is required for supplier order submission', {
        retryable: false
      });
    }

    const existingId = idempotencyIndex.get(payload.idempotencyKey);
    if (existingId) {
      const existing = this.getOrderRecord(existingId);
      return {
        supplierOrderId: existing.id,
        status: existing.cancelled ? 'cancelled' : 'accepted',
        normalizedStatus: existing.cancelled ? 'cancelled' : 'accepted',
        tracking: null,
        idempotentReplay: true,
        mock: true,
        rawResponse: { mock: true, id: existing.id, reused: true }
      };
    }

    orderSequence += 1;
    const id = `MOCK-SO-${orderSequence}`;
    const record = {
      id,
      createdAt: Date.now(),
      cancelled: false,
      cancelReason: null,
      idempotencyKey: payload.idempotencyKey,
      orderReference: payload.orderNumber || null,
      itemCount: Array.isArray(payload.items) ? payload.items.length : 0
    };
    orderStore.set(id, record);
    idempotencyIndex.set(payload.idempotencyKey, id);

    return {
      supplierOrderId: id,
      status: 'accepted',
      normalizedStatus: NORMALIZED_SUPPLIER_STATUS.ACCEPTED,
      tracking: null,
      idempotentReplay: false,
      mock: true,
      rawResponse: { mock: true, id, status: 'accepted' }
    };
  }

  async getOrderStatus(supplierOrderId) {
    this.assertCapability('orderStatus', 'order status');
    const record = this.getOrderRecord(supplierOrderId);
    if (record.cancelled) {
      return {
        status: 'cancelled',
        normalizedStatus: NORMALIZED_SUPPLIER_STATUS.CANCELLED,
        updatedAt: new Date().toISOString(),
        mock: true
      };
    }

    const elapsedSeconds = (Date.now() - record.createdAt) / 1000;
    const timeline = this.timeline;
    let status = NORMALIZED_SUPPLIER_STATUS.ACCEPTED;
    if (elapsedSeconds >= timeline.delivered) status = NORMALIZED_SUPPLIER_STATUS.DELIVERED;
    else if (elapsedSeconds >= timeline.shipped) status = NORMALIZED_SUPPLIER_STATUS.SHIPPED;
    else if (elapsedSeconds >= timeline.processing) status = NORMALIZED_SUPPLIER_STATUS.PROCESSING;

    return { status, normalizedStatus: status, updatedAt: new Date().toISOString(), mock: true };
  }

  async getTrackingDetails(supplierOrderId) {
    this.assertCapability('tracking', 'tracking');
    const { normalizedStatus } = await this.getOrderStatus(supplierOrderId);
    if (!['shipped', 'delivered'].includes(normalizedStatus)) return null;

    return {
      courier: 'MockExpress (demo)',
      trackingNumber: `MOCKTRK-${supplierOrderId}`,
      trackingUrl: `https://mock-shipping.invalid/track/${encodeURIComponent(supplierOrderId)}`,
      status: normalizedStatus,
      updatedAt: new Date().toISOString(),
      mock: true
    };
  }

  async cancelSupplierOrder(supplierOrderId, reason = '') {
    this.assertCapability('cancellation', 'cancellation');
    const record = this.getOrderRecord(supplierOrderId);

    const { normalizedStatus } = await this.getOrderStatus(supplierOrderId);
    if (normalizedStatus === NORMALIZED_SUPPLIER_STATUS.DELIVERED) {
      throw new SupplierAdapterError('A delivered mock order cannot be cancelled', { retryable: false });
    }
    if (record.cancelled) {
      return { cancelled: true, alreadyCancelled: true, mock: true };
    }

    record.cancelled = true;
    record.cancelReason = String(reason).slice(0, 300);
    return { cancelled: true, alreadyCancelled: false, mock: true };
  }
}

/** Test helper: clears mock adapter order state between test suites. */
export const resetMockSupplierState = () => {
  orderStore.clear();
  idempotencyIndex.clear();
  orderSequence = 1000;
};
