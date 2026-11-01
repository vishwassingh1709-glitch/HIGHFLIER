import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { Coupon } from '../../models/Coupon.js';
import { Order } from '../../models/Order.js';
import { roundMoney } from '../../utils/money.js';
import { buildPaginationMeta, parsePagination } from '../../utils/http.js';
import { escapeRegex } from '../../utils/slugify.js';

const normalizeCode = (code) => String(code || '').trim().toUpperCase();

const isLive = (coupon, now = new Date()) =>
  coupon.isActive &&
  (!coupon.startsAt || coupon.startsAt <= now) &&
  (!coupon.expiresAt || coupon.expiresAt > now);

const couponAppliesToItem = (coupon, item) => {
  if (coupon.scope === 'all') return true;
  if (coupon.scope === 'category') {
    return (coupon.categories || []).some((id) => String(id) === String(item.category));
  }
  if (coupon.scope === 'product') {
    return (coupon.products || []).some((id) => String(id) === String(item.product));
  }
  return false;
};

/**
 * Validates a coupon against server-computed checkout items. Callers must pass
 * quantities and prices derived from the database, never from the browser.
 */
export const evaluateCoupon = async ({ code, userId, items, subtotal }) => {
  const normalized = normalizeCode(code);
  if (!normalized) throw ApiError.badRequest('Coupon code is required');

  const coupon = await Coupon.findOne({ code: normalized });
  if (!coupon) throw new ApiError(400, ERROR_CODES.INVALID_COUPON, 'This coupon code is not valid');
  if (!isLive(coupon)) {
    throw new ApiError(400, ERROR_CODES.INVALID_COUPON, 'This coupon has expired or is inactive');
  }
  if (Number(coupon.minOrderValue) > 0 && subtotal < coupon.minOrderValue) {
    throw new ApiError(
      400,
      ERROR_CODES.INVALID_COUPON,
      `This coupon requires a minimum order value of ₹${coupon.minOrderValue}`
    );
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw new ApiError(400, ERROR_CODES.INVALID_COUPON, 'This coupon has reached its usage limit');
  }
  if (userId && coupon.perUserLimit > 0) {
    const usedByUser = await Order.countDocuments({
      user: userId,
      'coupon.code': coupon.code,
      status: { $nin: ['cancelled'] }
    });
    if (usedByUser >= coupon.perUserLimit) {
      throw new ApiError(400, ERROR_CODES.INVALID_COUPON, 'You have already used this coupon');
    }
  }

  const eligibleItems = items.filter((item) => couponAppliesToItem(coupon, item));
  if (eligibleItems.length === 0) {
    throw new ApiError(400, ERROR_CODES.INVALID_COUPON, 'This coupon does not apply to the items in your cart');
  }

  const eligibleSubtotal = roundMoney(eligibleItems.reduce((sum, item) => sum + item.lineTotal, 0));
  let discount =
    coupon.discountType === 'percent'
      ? roundMoney((eligibleSubtotal * coupon.discountValue) / 100)
      : roundMoney(Math.min(coupon.discountValue, eligibleSubtotal));

  if (coupon.maxDiscount > 0 && discount > coupon.maxDiscount) discount = roundMoney(coupon.maxDiscount);
  if (discount > subtotal) discount = roundMoney(subtotal);

  return {
    coupon: {
      couponId: coupon._id,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue
    },
    discount,
    eligibleSubtotal
  };
};

/**
 * Atomically consumes one use of a coupon. Returns the coupon or null when the
 * usage limit was reached concurrently.
 */
export const redeemCoupon = async (couponId) => {
  const coupon = await Coupon.findOneAndUpdate(
    {
      _id: couponId,
      isActive: true,
      $or: [{ usageLimit: 0 }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }]
    },
    { $inc: { usedCount: 1 } },
    { new: true }
  );
  return coupon;
};

/** Gives a use back when an order is cancelled before fulfilment. */
export const releaseCoupon = async (couponId) => {
  await Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
};

export const validateCouponForCart = async (userId, code, payloadItems) => {
  const cartService = await import('../cart/cart.service.js');
  const cart = await cartService.getCart(userId);
  const purchasable = cart.items.filter((item) => item.isPurchasable);
  const items = purchasable.map((item) => ({
    product: item.product._id,
    category: item.product.category?._id || item.product.category,
    quantity: item.quantity,
    lineTotal: item.lineTotal
  }));
  if (items.length === 0) throw ApiError.badRequest('Add at least one available item to your cart first');
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const result = await evaluateCoupon({ code, userId, items, subtotal });
  return { ...result, subtotal, items: payloadItems || null };
};

export const createCoupon = async (payload, actorId = null) => {
  const code = normalizeCode(payload.code);
  const existing = await Coupon.findOne({ code });
  if (existing) throw ApiError.conflict(`Coupon code "${code}" already exists`);
  return Coupon.create({ ...payload, code, createdBy: actorId });
};

export const listCoupons = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.q) {
    filter.$or = [
      { code: new RegExp(escapeRegex(query.q), 'i') },
      { description: new RegExp(escapeRegex(query.q), 'i') }
    ];
  }
  const [coupons, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Coupon.countDocuments(filter)
  ]);
  return { coupons, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getCoupon = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.notFound('Coupon');
  const coupon = await Coupon.findById(id);
  if (!coupon) throw ApiError.notFound('Coupon');
  return coupon;
};

export const updateCoupon = async (id, payload) => {
  const coupon = await getCoupon(id);
  if (payload.code) {
    const code = normalizeCode(payload.code);
    const duplicate = await Coupon.findOne({ code, _id: { $ne: coupon._id } });
    if (duplicate) throw ApiError.conflict(`Coupon code "${code}" already exists`);
    coupon.code = code;
  }
  const mutable = [
    'description',
    'discountType',
    'discountValue',
    'maxDiscount',
    'minOrderValue',
    'scope',
    'categories',
    'products',
    'usageLimit',
    'perUserLimit',
    'startsAt',
    'expiresAt',
    'isActive'
  ];
  for (const key of mutable) {
    if (payload[key] !== undefined) coupon[key] = payload[key];
  }
  await coupon.save();
  return coupon;
};

export const deactivateCoupon = async (id) => {
  const coupon = await getCoupon(id);
  coupon.isActive = false;
  await coupon.save();
  return coupon;
};
