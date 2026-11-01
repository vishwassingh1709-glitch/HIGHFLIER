import mongoose from 'mongoose';
import { Review } from '../../models/Review.js';
import { Product } from '../../models/Product.js';
import { Order } from '../../models/Order.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildPaginationMeta, parsePagination } from '../../utils/http.js';
import { ORDER_STATUS } from '../../constants/orderStatus.js';
import { env } from '../../config/env.js';
import { recordAudit } from '../admin/audit.service.js';

const PRODUCT_CARD_SELECT = 'title slug images ratingAverage ratingCount status';

const toPublicReview = (review, currentUserId = null) => {
  const doc = review.toObject ? review.toObject() : review;
  const authorDoc = doc.user && typeof doc.user === 'object' ? doc.user : null;
  return {
    id: String(doc._id),
    product: doc.product && typeof doc.product === 'object' ? doc.product : doc.product,
    rating: doc.rating,
    title: doc.title,
    comment: doc.comment,
    images: doc.images || [],
    isVerifiedPurchase: Boolean(doc.isVerifiedPurchase),
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    author: authorDoc ? { id: String(authorDoc._id), name: authorDoc.name } : null,
    mine: currentUserId ? String(authorDoc?._id || doc.user) === String(currentUserId) : false
  };
};

export const recomputeProductRating = async (productId) => {
  const [stats] = await Review.aggregate([
    {
      $match: {
        product: new mongoose.Types.ObjectId(productId),
        status: 'approved'
      }
    },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);

  const ratingAverage = stats ? Math.round(stats.average * 10) / 10 : 0;
  const ratingCount = stats ? stats.count : 0;
  await Product.updateOne({ _id: productId }, { $set: { ratingAverage, ratingCount } });
  return { ratingAverage, ratingCount };
};

const findDeliveredOrderForProduct = async (userId, productId) =>
  Order.findOne({
    user: userId,
    status: { $in: [ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED] },
    'items.product': productId
  })
    .sort({ deliveredAt: -1, createdAt: -1 })
    .select('_id orderNumber deliveredAt');

const buildSort = (sort) => {
  switch (sort) {
    case 'oldest':
      return { createdAt: 1 };
    case 'highest':
      return { rating: -1, createdAt: -1 };
    case 'lowest':
      return { rating: 1, createdAt: -1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
};

export const listProductReviews = async (productId, query, currentUserId = null) => {
  const product = await Product.findById(productId).select('_id');
  if (!product) throw ApiError.notFound('Product');

  const { page, limit, skip } = parsePagination(query, { defaultLimit: 10, maxLimit: env.MAX_PAGE_SIZE });
  const filter = { product: productId, status: 'approved' };
  if (query.rating) filter.rating = query.rating;

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort(buildSort(query.sort))
      .skip(skip)
      .limit(limit)
      .populate('user', 'name'),
    Review.countDocuments(filter)
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalRatings = 0;
  let ratingSum = 0;
  const rows = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), status: 'approved' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } }
  ]);
  for (const row of rows) {
    distribution[row._id] = row.count;
    totalRatings += row.count;
    ratingSum += row._id * row.count;
  }

  return {
    reviews: reviews.map((review) => toPublicReview(review, currentUserId)),
    summary: {
      average: totalRatings === 0 ? 0 : Math.round((ratingSum / totalRatings) * 10) / 10,
      total: totalRatings,
      distribution
    },
    meta: buildPaginationMeta({ page, limit, total })
  };
};

export const createReview = async (user, productId, payload) => {
  const product = await Product.findById(productId).select(PRODUCT_CARD_SELECT);
  if (!product) throw ApiError.notFound('Product');

  const existing = await Review.findOne({ user: user._id, product: product._id }).select('_id');
  if (existing) throw ApiError.conflict('You have already reviewed this product');

  const order = await findDeliveredOrderForProduct(user._id, product._id);
  if (!order) {
    throw ApiError.forbidden('Only customers with a delivered order for this product can review it');
  }

  const review = await Review.create({
    user: user._id,
    product: product._id,
    order: order._id,
    rating: payload.rating,
    title: payload.title || '',
    comment: payload.comment,
    images: payload.images || [],
    isVerifiedPurchase: true,
    status: 'approved'
  });

  const aggregate = await recomputeProductRating(product._id);
  const populated = await review.populate('user', 'name');
  return { review: toPublicReview(populated, user._id), product: { ...aggregate } };
};

export const listMyReviews = async (user, query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: env.MAX_PAGE_SIZE });
  const filter = { user: user._id };
  if (query.status) filter.status = query.status;

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name')
      .populate('product', PRODUCT_CARD_SELECT),
    Review.countDocuments(filter)
  ]);

  return {
    reviews: reviews.map((review) => ({
      ...toPublicReview(review, user._id),
      product: review.product && typeof review.product === 'object'
        ? {
            id: String(review.product._id),
            title: review.product.title,
            slug: review.product.slug,
            image: review.product.images?.find((image) => image.isPrimary)?.url || review.product.images?.[0]?.url || '',
            ratingAverage: review.product.ratingAverage,
            ratingCount: review.product.ratingCount
          }
        : null,
      moderationNote: review.status === 'rejected' ? review.moderationNote : ''
    })),
    meta: buildPaginationMeta({ page, limit, total })
  };
};

export const updateReview = async (user, reviewId, payload) => {
  const review = await Review.findOne({ _id: reviewId, user: user._id });
  if (!review) throw ApiError.notFound('Review');

  if (payload.rating !== undefined) review.rating = payload.rating;
  if (payload.title !== undefined) review.title = payload.title;
  if (payload.comment !== undefined) review.comment = payload.comment;
  if (payload.images !== undefined) review.images = payload.images;
  await review.save();

  if (review.status === 'approved') await recomputeProductRating(review.product);
  const populated = await review.populate('user', 'name');
  return toPublicReview(populated, user._id);
};

export const deleteReview = async (user, reviewId) => {
  const review = await Review.findOne({ _id: reviewId, user: user._id });
  if (!review) throw ApiError.notFound('Review');

  await review.deleteOne();
  const aggregate = await recomputeProductRating(review.product);
  return { message: 'Review deleted', product: aggregate };
};

export const listReviewsAdmin = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: env.MAX_PAGE_SIZE });
  const filter = {};
  if (query.product) filter.product = query.product;
  if (query.user) filter.user = query.user;
  if (query.rating) filter.rating = query.rating;
  if (query.status) filter.status = query.status;

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email')
      .populate('product', 'title slug status'),
    Review.countDocuments(filter)
  ]);

  return {
    reviews: reviews.map((review) => ({
      ...toPublicReview(review),
      moderationNote: review.moderationNote,
      moderatedAt: review.moderatedAt,
      order: review.order
    })),
    meta: buildPaginationMeta({ page, limit, total })
  };
};

export const moderateReviewAdmin = async (admin, reviewId, { status, note }, { req = null } = {}) => {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound('Review');

  review.status = status;
  review.moderationNote = note || '';
  review.moderatedBy = admin._id;
  review.moderatedAt = new Date();
  await review.save();

  const aggregate = await recomputeProductRating(review.product);
  await recordAudit({
    req,
    actor: admin._id,
    action: `review.${status}`,
    entityType: 'Review',
    entityId: review._id,
    metadata: { productId: String(review.product), rating: review.rating }
  });

  const populated = await review.populate(['user', 'product']);
  return { review: toPublicReview(populated), product: aggregate };
};

export const deleteReviewAdmin = async (admin, reviewId, { req = null } = {}) => {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound('Review');

  const productId = review.product;
  await review.deleteOne();
  const aggregate = await recomputeProductRating(productId);
  await recordAudit({
    req,
    actor: admin._id,
    action: 'review.delete',
    entityType: 'Review',
    entityId: reviewId,
    metadata: { productId: String(productId) }
  });
  return { message: 'Review deleted', product: aggregate };
};
