import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { SYNC_LOG_STATUS } from '../../constants/supplier.js';
import { Product } from '../../models/Product.js';
import { Category } from '../../models/Category.js';
import { Brand } from '../../models/Brand.js';
import { Supplier } from '../../models/Supplier.js';
import { InventoryTransaction } from '../../models/InventoryTransaction.js';
import { slugify } from '../../utils/slugify.js';
import { withKeyLock } from '../../utils/lock.js';
import { applyMarkupToVariants } from '../products/pricing.service.js';
import { getSupplierAdapter } from './suppliers.service.js';
import { createSyncLog, finishSyncLog } from './syncLog.service.js';

const MAX_PAGES = 200;
const MAX_PRODUCTS = 10000;
const PAGE_SIZE = 50;

const ensureUniqueProductSlug = async (title, supplier, excludeId = null) => {
  const base = `${slugify(title)}-${slugify(supplier.code)}`.slice(0, 140);
  let slug = base;
  let suffix = 2;
  /* eslint-disable no-await-in-loop */
  while (await Product.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 100) throw new Error('Unable to generate a unique product slug');
  }
  return slug;
};

const resolveCategory = async (name, cache) => {
  if (!name || typeof name !== 'string' || !name.trim()) return null;
  const key = name.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const slug = slugify(name);
  const category = await Category.findOneAndUpdate(
    { slug },
    { $setOnInsert: { name: name.trim(), slug, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  cache.set(key, category._id);
  return category._id;
};

const resolveBrand = async (name, cache) => {
  if (!name || typeof name !== 'string' || !name.trim()) return null;
  const key = name.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const slug = slugify(name);
  const brand = await Brand.findOneAndUpdate(
    { slug },
    { $setOnInsert: { name: name.trim(), slug, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  cache.set(key, brand._id);
  return brand._id;
};

const normalizeImages = (images) => {
  const normalized = (Array.isArray(images) ? images : [])
    .map((image) => (typeof image === 'string' ? { url: image } : image || {}))
    .filter((image) => typeof image.url === 'string' && /^https?:\/\//i.test(image.url))
    .slice(0, 20)
    .map((image) => ({
      url: image.url,
      publicId: image.publicId || '',
      alt: String(image.alt || '').slice(0, 200),
      isPrimary: Boolean(image.isPrimary)
    }));

  if (normalized.length > 0 && !normalized.some((image) => image.isPrimary)) {
    normalized[0].isPrimary = true;
  }
  return normalized;
};

const normalizeRawProduct = (raw, supplier, existingProduct) => {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid product payload');
  const supplierProductId = String(raw.supplierProductId ?? '').trim();
  const title = String(raw.title ?? '').trim();
  if (!supplierProductId) throw new Error('Missing supplierProductId');
  if (!title) throw new Error('Missing product title');

  const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
  if (rawVariants.length === 0) throw new Error('Product has no variants');

  const seenSkus = new Set();
  const existingVariants = new Map((existingProduct?.variants || []).map((variant) => [variant.sku, variant]));

  const variants = rawVariants.map((variant, index) => {
    const sku = String(variant?.sku || `${supplierProductId}-${index + 1}`).trim();
    if (!sku) throw new Error('Variant SKU is missing');
    if (seenSkus.has(sku)) throw new Error(`Duplicate variant SKU "${sku}"`);
    seenSkus.add(sku);

    const supplierCost = Number(variant?.supplierCost);
    if (!Number.isFinite(supplierCost) || supplierCost < 0) {
      throw new Error(`Variant "${sku}" has an invalid supplier cost`);
    }
    const stockValue = Math.floor(Number(variant?.stock));
    const stock = Number.isFinite(stockValue) ? Math.max(0, stockValue) : 0;
    const mrpValue = Number(variant?.mrp);
    const mrp = Number.isFinite(mrpValue) && mrpValue > 0 ? mrpValue : 0;

    const previous = existingVariants.get(sku);
    return {
      sku,
      supplierVariantId: String(variant?.supplierVariantId ?? '').trim(),
      name: String(variant?.name || sku).trim().slice(0, 120),
      attributes: variant?.attributes && typeof variant.attributes === 'object' ? variant.attributes : {},
      supplierCost,
      mrp,
      sellingPrice: 0,
      stock,
      reserved: previous?.reserved || 0,
      isActive: variant?.isActive !== false,
      isPriceLocked: previous?.isPriceLocked || false
    };
  });

  const summary = applyMarkupToVariants(variants, supplier.markupRule);
  const description = String(raw.description || '').slice(0, 10000);

  return {
    supplier: supplier._id,
    supplierProductId,
    supplierSku: String(raw.supplierSku || '').slice(0, 120),
    title: title.slice(0, 250),
    description,
    shortDescription: String(raw.shortDescription || description.slice(0, 300)).slice(0, 300),
    images: normalizeImages(raw.images),
    attributes: raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {},
    variants,
    supplierCost: summary.supplierCost,
    sellingPrice: summary.sellingPrice,
    mrp: summary.mrp,
    stock: summary.stock,
    currency: 'INR',
    lastSyncedAt: new Date(),
    supplierStatus: 'available',
    imported: true,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag).slice(0, 60)).slice(0, 20) : []
  };
};

const upsertImportedProduct = async ({ raw, supplier, caches, syncLogId }) => {
  const existing = await Product.findOne({
    supplier: supplier._id,
    supplierProductId: String(raw?.supplierProductId ?? '').trim()
  });

  const normalized = normalizeRawProduct(raw, supplier, existing);
  normalized.category = await resolveCategory(raw.category, caches.categories);
  normalized.brand = await resolveBrand(raw.brand, caches.brands);

  if (existing) {
    const previousStockBySku = new Map(existing.variants.map((variant) => [variant.sku, variant.stock]));
    existing.set(normalized);
    await existing.save();

    const transactions = existing.variants
      .filter((variant) => previousStockBySku.get(variant.sku) !== undefined && previousStockBySku.get(variant.sku) !== variant.stock)
      .map((variant) => ({
        product: existing._id,
        variantSku: variant.sku,
        type: 'sync',
        quantity: variant.stock - previousStockBySku.get(variant.sku),
        previousStock: previousStockBySku.get(variant.sku),
        newStock: variant.stock,
        reference: { kind: 'catalogue_sync', id: syncLogId || null },
        note: 'Catalogue sync adjusted stock'
      }));

    if (transactions.length > 0) await InventoryTransaction.insertMany(transactions);
    return { outcome: 'updated', sku: normalized.supplierSku };
  }

  const slug = await ensureUniqueProductSlug(normalized.title, supplier);
  const product = await Product.create({
    ...normalized,
    slug,
    status: env.AUTO_ACTIVATE_IMPORTED_PRODUCTS ? 'active' : 'draft'
  });

  await InventoryTransaction.insertMany(
    product.variants
      .filter((variant) => variant.stock > 0)
      .map((variant) => ({
        product: product._id,
        variantSku: variant.sku,
        type: 'import',
        quantity: variant.stock,
        previousStock: 0,
        newStock: variant.stock,
        reference: { kind: 'catalogue_sync', id: syncLogId || null },
        note: 'Product imported from supplier catalogue'
      }))
  );

  return { outcome: 'created', sku: normalized.supplierSku };
};

export const syncCatalogue = async (
  supplierId,
  { triggeredBy = 'manual', userId = null, requestId = '', maxPages = MAX_PAGES } = {}
) => {
  const { supplier, adapter } = await getSupplierAdapter(supplierId);
  if (!adapter.supports('catalogue')) {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_UNSUPPORTED, 'Supplier does not support catalogue import');
  }

  return withKeyLock(`supplier-sync:${supplierId}`, async () => {
    const log = await createSyncLog({
      supplier: supplier._id,
      type: 'catalogue',
      status: SYNC_LOG_STATUS.STARTED,
      message: 'Catalogue sync started',
      triggeredBy,
      triggeredByUser: userId,
      requestId
    });

    const stats = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
    const errors = [];
    const caches = { categories: new Map(), brands: new Map() };

    try {
      let page = 1;
      let cursor = null;
      let hasMore = true;
      let pagesFetched = 0;

      while (hasMore && pagesFetched < maxPages && stats.total < MAX_PRODUCTS) {
        const result = await adapter.fetchProducts({ page, limit: PAGE_SIZE, cursor });
        const items = Array.isArray(result?.products) ? result.products : [];
        pagesFetched += 1;

        for (const raw of items) {
          stats.total += 1;
          try {
            const { outcome } = await upsertImportedProduct({
              raw,
              supplier,
              caches,
              syncLogId: log._id
            });
            stats[outcome] += 1;
          } catch (error) {
            stats.failed += 1;
            errors.push({
              message: error.message,
              sku: String(raw?.supplierSku || raw?.supplierProductId || ''),
              context: 'catalogue_import'
            });
          }
        }

        hasMore = Boolean(result?.hasMore) && items.length > 0;
        if (result?.nextCursor) cursor = result.nextCursor;
        page = Number(result?.nextPage) || page + 1;
      }

      const status = stats.failed > 0 ? SYNC_LOG_STATUS.PARTIAL : SYNC_LOG_STATUS.SUCCESS;
      await finishSyncLog(log._id, {
        status,
        message: `Catalogue sync completed: ${stats.created} created, ${stats.updated} updated, ${stats.failed} failed`,
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
        message: 'Catalogue sync failed',
        stats,
        errors: [...errors, { message: error.message, context: 'catalogue_sync' }]
      });
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, ERROR_CODES.SUPPLIER_ERROR, `Catalogue sync failed: ${error.message}`);
    }
  });
};
