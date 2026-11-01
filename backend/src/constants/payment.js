export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  CREATED: 'created',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  COD_PENDING: 'cod_pending'
});

export const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUS);

export const PAYMENT_METHOD = Object.freeze({
  ONLINE: 'online',
  COD: 'cod'
});

export const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHOD);

export const PAYMENT_PROVIDER = Object.freeze({
  RAZORPAY: 'razorpay',
  MOCK: 'mock',
  COD: 'cod'
});

export const REFUND_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSED: 'processed',
  FAILED: 'failed'
});
