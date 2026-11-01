import { asyncHandler, sendSuccess } from '../../utils/http.js';
import * as cartService from './cart.service.js';

export const getCart = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user._id);
  return sendSuccess(res, cart);
});

export const addItem = asyncHandler(async (req, res) => {
  const cart = await cartService.addItem(req.user._id, req.body);
  return sendSuccess(res, cart, { status: 201 });
});

export const updateItem = asyncHandler(async (req, res) => {
  const cart = await cartService.updateItem(
    req.user._id,
    req.params.productId,
    req.params.sku,
    req.body.quantity
  );
  return sendSuccess(res, cart);
});

export const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.user._id, req.params.productId, req.params.sku);
  return sendSuccess(res, cart);
});

export const clearCart = asyncHandler(async (req, res) => {
  const cart = await cartService.clearCart(req.user._id);
  return sendSuccess(res, cart);
});
