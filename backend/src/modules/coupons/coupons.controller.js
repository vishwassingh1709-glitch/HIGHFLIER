import { asyncHandler, sendCreated, sendSuccess } from '../../utils/http.js';
import * as couponsService from './coupons.service.js';

export const validateCoupon = asyncHandler(async (req, res) => {
  const result = await couponsService.validateCouponForCart(req.user._id, req.body.code, req.body.items);
  return sendSuccess(res, {
    code: result.coupon.code,
    description: result.coupon.description,
    discountType: result.coupon.discountType,
    discountValue: result.coupon.discountValue,
    discount: result.discount,
    subtotal: result.subtotal,
    eligibleSubtotal: result.eligibleSubtotal
  });
});

export const listCoupons = asyncHandler(async (req, res) => {
  const result = await couponsService.listCoupons(req.query);
  return sendSuccess(res, result.coupons, { meta: result.meta });
});

export const createCoupon = asyncHandler(async (req, res) =>
  sendCreated(res, await couponsService.createCoupon(req.body, req.user._id))
);

export const getCoupon = asyncHandler(async (req, res) =>
  sendSuccess(res, await couponsService.getCoupon(req.params.id))
);

export const updateCoupon = asyncHandler(async (req, res) =>
  sendSuccess(res, await couponsService.updateCoupon(req.params.id, req.body))
);

export const deactivateCoupon = asyncHandler(async (req, res) =>
  sendSuccess(res, await couponsService.deactivateCoupon(req.params.id))
);
