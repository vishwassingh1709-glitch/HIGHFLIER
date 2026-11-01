import { asyncHandler, sendSuccess } from '../../utils/http.js';
import { toCustomerOrder } from '../orders/orders.service.js';
import * as paymentsService from './payments.service.js';

export const createPaymentOrder = asyncHandler(async (req, res) => {
  const result = await paymentsService.createPaymentForOrder(req.user._id, req.params.orderId, {
    requestId: req.id
  });
  return sendSuccess(res, {
    ...result,
    ...(result.order ? { order: toCustomerOrder(result.order) } : {})
  });
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const result = await paymentsService.verifyPayment(req.user._id, req.body);
  return sendSuccess(res, {
    payment: paymentsService.toPublicPayment(result.payment),
    order: toCustomerOrder(result.order),
    replay: Boolean(result.replay)
  });
});

export const mockPay = asyncHandler(async (req, res) => {
  const result = await paymentsService.simulateMockPayment(req.user._id, req.body.orderId, {
    outcome: req.body.outcome
  });
  return sendSuccess(res, {
    mock: true,
    payment: paymentsService.toPublicPayment(result.payment),
    order: result.order ? toCustomerOrder(result.order) : null,
    replay: Boolean(result.replay),
    failed: Boolean(result.failed)
  });
});

export const webhook = asyncHandler(async (req, res) => {
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const signature = req.get('x-razorpay-signature') || req.get('x-webhook-signature') || '';
  const result = await paymentsService.handleWebhook({ rawBody, signature });
  return sendSuccess(res, result, { status: 200 });
});

export const getOrderPayments = asyncHandler(async (req, res) =>
  sendSuccess(res, await paymentsService.getPaymentsForOrder(req.user._id, req.params.orderId))
);

export const getPaymentConfig = asyncHandler(async (_req, res) =>
  sendSuccess(res, paymentsService.getPaymentConfig())
);

export const listPaymentsAdmin = asyncHandler(async (req, res) => {
  const result = await paymentsService.listPaymentsAdmin(req.query);
  return sendSuccess(res, result.payments, { meta: result.meta });
});
