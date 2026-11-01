import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { idParamSchema } from '../../validators/common.js';
import * as controller from './brands.controller.js';
import { createBrandSchema, updateBrandSchema } from '../categories/categories.validators.js';
import { slugParamSchema } from '../categories/categories.validators.js';

export const brandsRouter = Router();
brandsRouter.get('/', controller.listBrands);
brandsRouter.get('/:slug', validate(slugParamSchema, 'params'), controller.getBrand);

export const adminBrandsRouter = Router();
adminBrandsRouter.use(requireAdmin);
adminBrandsRouter.get('/', controller.listBrands);
adminBrandsRouter.post('/', validate(createBrandSchema), controller.createBrand);
adminBrandsRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateBrandSchema),
  controller.updateBrand
);
adminBrandsRouter.delete('/:id', validate(idParamSchema, 'params'), controller.deactivateBrand);
