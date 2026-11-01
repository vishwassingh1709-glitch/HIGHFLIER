import { decryptJson } from '../../../utils/crypto.js';
import { ApiError } from '../../../utils/ApiError.js';
import { ERROR_CODES } from '../../../constants/errorCodes.js';
import { SUPPLIER_ADAPTER_TYPES } from '../../../constants/supplier.js';
import { MockSupplierAdapter } from './mockAdapter.js';
import { GenericRestSupplierAdapter } from './genericRestAdapter.js';

/**
 * Builds an adapter instance for a supplier. The supplier document must be
 * loaded with `+credentials` when credentials are needed.
 */
export const createSupplierAdapter = (supplier) => {
  let credentials = {};
  if (supplier?.credentials?.ciphertext) {
    try {
      credentials = decryptJson(supplier.credentials);
    } catch {
      throw new ApiError(
        500,
        ERROR_CODES.SUPPLIER_ERROR,
        'Stored supplier credentials could not be decrypted. Verify APP_ENCRYPTION_KEY has not changed.'
      );
    }
  }

  switch (supplier.adapterType) {
    case SUPPLIER_ADAPTER_TYPES.MOCK:
      return new MockSupplierAdapter({ supplier, credentials });
    case SUPPLIER_ADAPTER_TYPES.GENERIC_REST:
      return new GenericRestSupplierAdapter({ supplier, credentials });
    default:
      throw new ApiError(500, ERROR_CODES.SUPPLIER_ERROR, `Unsupported supplier adapter "${supplier.adapterType}"`);
  }
};

export { MockSupplierAdapter } from './mockAdapter.js';
export { GenericRestSupplierAdapter } from './genericRestAdapter.js';
export { SupplierAdapterError } from './errors.js';
