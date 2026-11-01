import { asyncHandler, sendSuccess } from '../../utils/http.js';
import * as productsService from './products.service.js';

export const listProducts = asyncHandler(async (req, res) => {
  const { products, meta } = await productsService.listPublicProducts(req.query);
  sendSuccess(res, { products }, { meta });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await productsService.getPublicProduct(req.params.identifier);
  sendSuccess(res, { product });
});

export const adminListProducts = asyncHandler(async (req, res) => {
  const { products, meta } = await productsService.listAdminProducts(req.query);
  sendSuccess(res, { products }, { meta });
});

export const adminGetProduct = asyncHandler(async (req, res) => {
  const product = await productsService.getAdminProduct(req.params.id);
  sendSuccess(res, { product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await productsService.updateProduct(req.params.id, req.body);
  sendSuccess(res, { product });
});

export const activateProduct = asyncHandler(async (req, res) => {
  const product = await productsService.setProductStatus(req.params.id, 'active');
  sendSuccess(res, { product });
});

export const deactivateProduct = asyncHandler(async (req, res) => {
  const product = await productsService.setProductStatus(req.params.id, 'inactive');
  sendSuccess(res, { product });
});

export const discontinueProduct = asyncHandler(async (req, res) => {
  const result = await productsService.discontinueProduct(req.params.id);
  sendSuccess(res, result);
});
