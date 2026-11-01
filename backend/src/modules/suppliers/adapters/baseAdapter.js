import { unsupportedOperation } from './errors.js';

/**
 * Common supplier adapter contract. Each supplier must implement only the
 * operations its official API actually supports; capabilities describe which
 * methods are safe to call. HIGHFLIER never invents supplier endpoints.
 */
export class BaseSupplierAdapter {
  constructor({ supplier, credentials = {} }) {
    this.supplier = supplier;
    this.credentials = credentials;
    this.name = supplier?.name || 'supplier';
    this.capabilities = supplier?.capabilities || {};
    this.isMock = Boolean(supplier?.isMock);
  }

  supports(capability) {
    return Boolean(this.capabilities?.[capability]);
  }

  assertCapability(capability, label = capability) {
    if (!this.supports(capability)) throw unsupportedOperation(label, this.name);
  }

  async testConnection() {
    throw unsupportedOperation('testConnection', this.name);
  }

  async fetchProducts() {
    throw unsupportedOperation('fetchProducts', this.name);
  }

  async fetchInventory() {
    throw unsupportedOperation('fetchInventory', this.name);
  }

  async createSupplierOrder() {
    throw unsupportedOperation('createSupplierOrder', this.name);
  }

  async getOrderStatus() {
    throw unsupportedOperation('getOrderStatus', this.name);
  }

  async getTrackingDetails() {
    throw unsupportedOperation('getTrackingDetails', this.name);
  }

  async cancelSupplierOrder() {
    throw unsupportedOperation('cancelSupplierOrder', this.name);
  }
}
