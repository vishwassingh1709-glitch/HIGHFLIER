import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { SYNC_LOG_STATUS } from '../../constants/supplier.js';
import { Product } from '../../models/Product.js';
import { Supplier } from '../../models/Supplier.js';
import { InventoryTransaction } from '../../models/InventoryTransaction.js';
import { withKeyLock } from '../../utils/lock.js';
import { getSupplierAdapter } from './suppliers.service.js';
import { createSyncLog, finishSyncLog } from './syncLog.service.js';

const buildLookupKey = (supplierProductId, reference) => `${String(supplierProductId)}::${String(reference)}`;

export const syncInventory = async (
  supplierId,
  {
    triggeredBy = 'manual',
    userId = null,
    requestId = '',
    markMissingUnavailable = false
  } = {}
) => {
  const { supplier, adapter } = await getSupplierAdapter(supplierId);
  if (!adapter.supports('inventory')) {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_UNSUPPORTED, 'Supplier does not support inventory sync');
  }

  return withKeyLock(`supplier-sync:${supplierId}`, async () => {
    const log = await createSyncLog({
      supplier: supplier._id,
      type: 'inventory',
      status: SYNC_LOG_STATUS.STARTED,
      message: 'Inventory sync started',
      triggeredBy,
      triggeredByUser: userId,
      requestId
    });

    const stats = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
    const errors = [];
    const transactions = [];

    try {
      const inventory = await adapter.fetchInventory();
      const items = Array.isArray(inventory?.items) ? inventory.items : [];
      if (items.length === 0) {
        throw new Error('Supplier returned no inventory records; stock was left unchanged');
      }

      const lookup = new Map();
      for (const item of items) {
        if (item?.supplierProductId === undefined) continue;
        if (item.supplierVariantId) {
          lookup.set(buildLookupKey(item.supplierProductId, item.supplierVariantId), item);
        }
        if (item.sku) {
          lookup.set(buildLookupKey(item.supplierProductId, item.sku), item);
        }
      }

      const products = await Product.find({ supplier: supplier._id });

      for (const product of products) {
        stats.total += 1;
        let matchedAny = false;
        const previousStockBySku = new Map();

        for (const variant of product.variants) {
          const item =
            (variant.supplierVariantId &&
              lookup.get(buildLookupKey(product.supplierProductId, variant.supplierVariantId))) ||
            lookup.get(buildLookupKey(product.supplierProductId, variant.sku));

          if (!item) {
            stats.skipped += 1;
            continue;
          }

          matchedAny = true;
          const stockValue = Math.floor(Number(item.stock));
          if (!Number.isFinite(stockValue)) {
            stats.failed += 1;
            errors.push({
              message: `Invalid stock value for SKU "${variant.sku}"`,
              sku: variant.sku,
              context: 'inventory_sync'
            });
            continue;
          }

          const newStock = Math.max(0, stockValue);
          if (newStock === variant.stock) {
            stats.skipped += 1;
            continue;
          }

          previousStockBySku.set(variant.sku, variant.stock);
          variant.stock = newStock;
          stats.updated += 1;
          transactions.push({
            product: product._id,
            variantSku: variant.sku,
            type: 'sync',
            quantity: newStock - previousStockBySku.get(variant.sku),
            previousStock: previousStockBySku.get(variant.sku),
            newStock,
            reference: { kind: 'inventory_sync', id: log._id },
            note: 'Inventory sync from supplier'
          });
        }

        if (matchedAny) {
          product.stock = product.variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
          product.supplierStatus = product.availableStock > 0 ? 'available' : 'unavailable';
          product.lastSyncedAt = new Date();
          await product.save();
        } else if (markMissingUnavailable) {
          product.supplierStatus = 'unavailable';
          product.lastSyncedAt = new Date();
          await product.save();
          stats.updated += 1;
        }
      }

      if (transactions.length > 0) await InventoryTransaction.insertMany(transactions);

      const status = stats.failed > 0 ? SYNC_LOG_STATUS.PARTIAL : SYNC_LOG_STATUS.SUCCESS;
      await finishSyncLog(log._id, {
        status,
        message: `Inventory sync completed: ${stats.updated} variants updated, ${stats.failed} failed`,
        stats,
        errors
      });
      await Supplier.updateOne({ _id: supplier._id }, { $set: { lastSyncAt: new Date() } });

      return {
        supplierId: supplier._id,
        supplierName: supplier.name,
        isMock: supplier.isMock,
        stats,
        errors,
        logId: log._id,
        mock: Boolean(supplier.isMock)
      };
    } catch (error) {
      await finishSyncLog(log._id, {
        status: SYNC_LOG_STATUS.FAILED,
        message: 'Inventory sync failed',
        stats,
        errors: [...errors, { message: error.message, context: 'inventory_sync' }]
      });
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, ERROR_CODES.SUPPLIER_ERROR, `Inventory sync failed: ${error.message}`);
    }
  });
};

export const markStaleProducts = async (
  supplierId,
  { hours = env.STALE_INVENTORY_HOURS, triggeredBy = 'manual', userId = null, requestId = '' } = {}
) => {
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw ApiError.notFound('Supplier');

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const log = await createSyncLog({
    supplier: supplier._id,
    type: 'inventory',
    status: SYNC_LOG_STATUS.STARTED,
    message: `Stale inventory scan started (cutoff ${cutoff.toISOString()})`,
    triggeredBy,
    triggeredByUser: userId,
    requestId
  });

  const result = await Product.updateMany(
    {
      supplier: supplier._id,
      supplierStatus: { $nin: ['stale', 'discontinued'] },
      $or: [{ lastSyncedAt: { $lt: cutoff } }, { lastSyncedAt: null }]
    },
    { $set: { supplierStatus: 'stale' } }
  );

  await finishSyncLog(log._id, {
    status: SYNC_LOG_STATUS.SUCCESS,
    message: `Marked ${result.modifiedCount} product(s) as stale`,
    stats: { total: result.matchedCount, updated: result.modifiedCount }
  });

  return {
    supplierId: supplier._id,
    staleProducts: result.modifiedCount,
    cutoff,
    logId: log._id
  };
};
