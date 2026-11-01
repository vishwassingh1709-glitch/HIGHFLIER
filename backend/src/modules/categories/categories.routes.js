import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { idParamSchema } from '../../validators/common.js';
import * as controller from './categories.controller.js';
import {
  createCategorySchema,
  slugParamSchema,
  updateCategorySchema
} from './categories.validators.js';

export const categoriesRouter = Router();
categoriesRouter.get('/', controller.listCategories);
categoriesRouter.get('/:slug', validate(slugParamSchema, 'params'), controller.getCategory);

export const adminCategoriesRouter = Router();
adminCategoriesRouter.use(requireAdmin);
adminCategoriesRouter.get('/', controller.listCategories);
adminCategoriesRouter.post('/', validate(createCategorySchema), controller.createCategory);
adminCategoriesRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateCategorySchema),
  controller.updateCategory
);
adminCategoriesRouter.delete('/:id', validate(idParamSchema, 'params'), controller.deactivateCategory);
