import Razorpay from 'razorpay';
import { env, isRazorpayConfigured } from '../../config/env.js';
import { hmacSha256Hex, randomToken, safeCompare } from '../../utils/crypto.js';
import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';

let razorpayClient = null;

const getRazorpayClient = () => {
  if (!isRazorpayConfigured) {
    throw new ApiError(503, ERROR_CODES.PAYMENT_NOT_CONFIGURED, 'Razorpay credentials are not configured');
  }
  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET
    });
  }
  return razorpayClient;
};

/**
 * Payment mode resolution:
 * - PAYMENTS_MOCK_MODE=true -> explicit, clearly labelled mock gateway (never
 *   allowed in production by env validation).
 * - Razorpay test/live keys -> real Razorpay SDK.
 * - neither -> payments unavailable (checkout returns 503).
 */
export const getPaymentMode = () => {
  if (env.PAYMENTS_MOCK_MODE) return 'mock';
  if (isRazorpayConfigured) return 'razorpay';
  return 'none';
};

export const isPaymentGatewayAvailable = () => getPaymentMode() !== 'none';

export const getPaymentProvider = () => {
  const mode = getPaymentMode();
  if (mode === 'mock') return 'mock';
  if (mode === 'razorpay') return 'razorpay';
  throw new ApiError(503, ERROR_CODES.PAYMENT_NOT_CONFIGURED, 'Payment gateway is not configured');
};

export const getPublicKeyId = () => (getPaymentMode() === 'mock' ? 'rzp_test_highflier_mock' : env.RAZORPAY_KEY_ID || '');

export const isMockPaymentMode = () => getPaymentMode() === 'mock';

export const buildMockCheckoutSignature = (providerOrderId, providerPaymentId) =>
  hmacSha256Hex(`${providerOrderId}|${providerPaymentId}`, env.mockPaymentSecret);

export const buildMockWebhookSignature = (rawBody) => hmacSha256Hex(rawBody, env.mockPaymentSecret);

export const createGatewayOrder = async ({ amountPaise, receipt, notes = {} }) => {
  const mode = getPaymentMode();
  if (mode === 'none') {
    throw new ApiError(503, ERROR_CODES.PAYMENT_NOT_CONFIGURED, 'Payment gateway is not configured');
  }
  if (mode === 'mock') {
    return {
      id: `order_mock_${randomToken(10)}`,
      entity: 'order',
      amount: amountPaise,
      currency: 'INR',
      receipt,
      status: 'created',
      notes,
      mock: true
    };
  }

  const order = await getRazorpayClient().orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    notes,
    payment_capture: 1
  });
  return { ...order, mock: false };
};

/**
 * Verifies the Razorpay checkout signature: HMAC-SHA256("<order_id>|<payment_id>")
 * using the key secret. Mock mode uses PAYMENT_MOCK_SECRET and is only reachable
 * when PAYMENTS_MOCK_MODE=true.
 */
export const verifyCheckoutSignature = ({ providerOrderId, providerPaymentId, signature }) => {
  if (!providerOrderId || !providerPaymentId || !signature) return false;
  const mode = getPaymentMode();
  if (mode === 'mock') {
    return safeCompare(buildMockCheckoutSignature(providerOrderId, providerPaymentId), signature);
  }
  if (mode !== 'razorpay') return false;
  const expected = hmacSha256Hex(`${providerOrderId}|${providerPaymentId}`, env.RAZORPAY_KEY_SECRET);
  return safeCompare(expected, signature);
};

export const verifyWebhookSignature = (rawBody, signature) => {
  if (!rawBody || !signature) return false;
  const mode = getPaymentMode();
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  if (mode === 'mock') return safeCompare(buildMockWebhookSignature(body), signature);
  if (mode !== 'razorpay' || !env.RAZORPAY_WEBHOOK_SECRET) return false;
  return safeCompare(hmacSha256Hex(body, env.RAZORPAY_WEBHOOK_SECRET), signature);
};

export const fetchGatewayPayment = async (providerPaymentId) => {
  if (getPaymentMode() !== 'razorpay') {
    return { id: providerPaymentId, status: 'captured', mock: true };
  }
  return getRazorpayClient().payments.fetch(providerPaymentId);
};

export const createGatewayRefund = async ({ providerPaymentId, amountPaise, notes = {} }) => {
  const mode = getPaymentMode();
  if (mode === 'mock') {
    return {
      id: `rfnd_mock_${randomToken(10)}`,
      entity: 'refund',
      payment_id: providerPaymentId,
      amount: amountPaise,
      status: 'processed',
      notes,
      mock: true
    };
  }
  if (mode !== 'razorpay') {
    throw new ApiError(503, ERROR_CODES.PAYMENT_NOT_CONFIGURED, 'Payment gateway is not configured');
  }
  return getRazorpayClient().payments.refund(providerPaymentId, {
    amount: amountPaise,
    notes,
    speed: 'normal'
  });
};
