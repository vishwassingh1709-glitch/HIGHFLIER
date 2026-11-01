import { asyncHandler, sendCreated, sendSuccess } from '../../utils/http.js';
import * as brandsService from './brands.service.js';

export const listBrands = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const brands = await brandsService.listBrands({ includeInactive });
  sendSuccess(res, { brands });
});

export const getBrand = asyncHandler(async (req, res) => {
  const brand = await brandsService.getBrandBySlug(req.params.slug);
  sendSuccess(res, { brand });
});

export const createBrand = asyncHandler(async (req, res) => {
  const brand = await brandsService.createBrand(req.body);
  sendCreated(res, { brand });
});

export const updateBrand = asyncHandler(async (req, res) => {
  const brand = await brandsService.updateBrand(req.params.id, req.body);
  sendSuccess(res, { brand });
});

export const deactivateBrand = asyncHandler(async (req, res) => {
  const result = await brandsService.deactivateBrand(req.params.id);
  sendSuccess(res, result);
});
