import { ERROR_CODES } from '../../../constants/errorCodes.js';

export class SupplierAdapterError extends Error {
  constructor(message, { code = ERROR_CODES.SUPPLIER_ERROR, retryable = false, statusCode = null, details = null } = {}) {
    super(message);
    this.name = 'SupplierAdapterError';
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const unsupportedOperation = (operation, supplierName) =>
  new SupplierAdapterError(`Supplier "${supplierName}" does not support ${operation}`, {
    code: ERROR_CODES.SUPPLIER_UNSUPPORTED,
    retryable: false
  });
