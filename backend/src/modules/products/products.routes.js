import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { idParamSchema } from '../../validators/common.js';
import * as controller from './products.controller.js';
import {
  adminListProductsQuerySchema,
  listProductsQuerySchema,
  productIdentifierParamSchema,
  updateProductSchema
} from './products.validators.js';

export const productsRouter = Router();
productsRouter.get('/', validate(listProductsQuerySchema, 'query'), controller.listProducts);
productsRouter.get(
  '/:identifier',
  validate(productIdentifierParamSchema, 'params'),
  controller.getProduct
);

export const adminProductsRouter = Router();
adminProductsRouter.use(requireAdmin);
adminProductsRouter.get('/', validate(adminListProductsQuerySchema, 'query'), controller.adminListProducts);
adminProductsRouter.get('/:id', validate(idParamSchema, 'params'), controller.adminGetProduct);
adminProductsRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateProductSchema),
  controller.updateProduct
);
adminProductsRouter.post('/:id/activate', validate(idParamSchema, 'params'), controller.activateProduct);
adminProductsRouter.post('/:id/deactivate', validate(idParamSchema, 'params'), controller.deactivateProduct);
adminProductsRouter.delete('/:id', validate(idParamSchema, 'params'), controller.discontinueProduct);
