import { asyncHandler, sendCreated, sendSuccess } from '../../utils/http.js';
import * as categoriesService from './categories.service.js';

export const listCategories = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const categories = await categoriesService.listCategories({ includeInactive });
  sendSuccess(res, { categories });
});

export const getCategory = asyncHandler(async (req, res) => {
  const category = await categoriesService.getCategoryBySlug(req.params.slug);
  sendSuccess(res, { category });
});

export const createCategory = asyncHandler(async (req, res) => {
  const category = await categoriesService.createCategory(req.body);
  sendCreated(res, { category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await categoriesService.updateCategory(req.params.id, req.body);
  sendSuccess(res, { category });
});

export const deactivateCategory = asyncHandler(async (req, res) => {
  const result = await categoriesService.deactivateCategory(req.params.id);
  sendSuccess(res, result);
});
