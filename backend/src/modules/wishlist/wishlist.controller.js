import { asyncHandler, sendSuccess } from '../../utils/http.js';
import * as wishlistService from './wishlist.service.js';

export const getWishlist = asyncHandler(async (req, res) =>
  sendSuccess(res, await wishlistService.getWishlist(req.user._id))
);

export const addProduct = asyncHandler(async (req, res) =>
  sendSuccess(res, await wishlistService.addProduct(req.user._id, req.body.productId), { status: 201 })
);

export const removeProduct = asyncHandler(async (req, res) =>
  sendSuccess(res, await wishlistService.removeProduct(req.user._id, req.params.productId))
);

export const clearWishlist = asyncHandler(async (req, res) =>
  sendSuccess(res, await wishlistService.clearWishlist(req.user._id))
);
