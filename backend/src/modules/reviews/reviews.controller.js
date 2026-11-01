import { asyncHandler, sendCreated, sendSuccess } from '../../utils/http.js';
import * as reviewsService from './reviews.service.js';

export const listProductReviews = asyncHandler(async (req, res) => {
  const result = await reviewsService.listProductReviews(
    req.params.productId,
    req.query,
    req.user?._id || null
  );
  return sendSuccess(res, { reviews: result.reviews, summary: result.summary }, { meta: result.meta });
});

export const createReview = asyncHandler(async (req, res) =>
  sendCreated(res, await reviewsService.createReview(req.user, req.params.productId, req.body))
);

export const listMyReviews = asyncHandler(async (req, res) => {
  const result = await reviewsService.listMyReviews(req.user, req.query);
  return sendSuccess(res, { reviews: result.reviews }, { meta: result.meta });
});

export const updateReview = asyncHandler(async (req, res) =>
  sendSuccess(res, { review: await reviewsService.updateReview(req.user, req.params.id, req.body) })
);

export const deleteReview = asyncHandler(async (req, res) =>
  sendSuccess(res, await reviewsService.deleteReview(req.user, req.params.id))
);

export const listReviewsAdmin = asyncHandler(async (req, res) => {
  const result = await reviewsService.listReviewsAdmin(req.query);
  return sendSuccess(res, { reviews: result.reviews }, { meta: result.meta });
});

export const moderateReviewAdmin = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await reviewsService.moderateReviewAdmin(req.user, req.params.id, req.body, { req })
  )
);

export const deleteReviewAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, await reviewsService.deleteReviewAdmin(req.user, req.params.id, { req }))
);
