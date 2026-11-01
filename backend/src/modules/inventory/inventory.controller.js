import { asyncHandler, sendSuccess } from '../../utils/http.js';
import * as inventoryService from './inventory.service.js';

export const listInventory = asyncHandler(async (req, res) => {
  const { products, meta } = await inventoryService.listInventory(req.query);
  sendSuccess(res, { products }, { meta });
});

export const listTransactions = asyncHandler(async (req, res) => {
  const { transactions, meta } = await inventoryService.listInventoryTransactions(req.query);
  sendSuccess(res, { transactions }, { meta });
});

export const adjustStock = asyncHandler(async (req, res) => {
  const result = await inventoryService.adjustVariantStock({
    productId: req.params.productId,
    sku: req.params.sku,
    stock: req.body.stock,
    adjustment: req.body.adjustment,
    note: req.body.note,
    adminId: req.user._id
  });
  sendSuccess(res, result);
});
