import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { Product } from '../../models/Product.js';
import { InventoryTransaction } from '../../models/InventoryTransaction.js';
import { buildPaginationMeta, parsePagination } from '../../utils/http.js';
import { escapeRegex } from '../../utils/slugify.js';

const availableExpr = (sku) => ({
  $subtract: [
    {
      $arrayElemAt: [
        {
          $map: {
            input: {
              $filter: {
                input: '$variants',
                as: 'v',
                cond: { $and: [{ $eq: ['$$v.sku', sku] }, { $eq: ['$$v.isActive', true] }] }
              }
            },
            in: '$$this.stock'
          }
        },
        0
      ]
    },
    {
      $arrayElemAt: [
        {
          $map: {
            input: {
              $filter: {
                input: '$variants',
                as: 'v',
                cond: { $and: [{ $eq: ['$$v.sku', sku] }, { $eq: ['$$v.isActive', true] }] }
              }
            },
            in: '$$this.reserved'
          }
        },
        0
      ]
    }
  ]
});

/**
 * Atomically reserves stock for a variant. The condition is evaluated inside
 * MongoDB so concurrent checkouts cannot oversell.
 */
export const reserveVariantStock = async (productId, sku, quantity, { session = null } = {}) => {
  const query = Product.findOneAndUpdate(
    {
      _id: productId,
      status: 'active',
      supplierStatus: 'available',
      'variants.sku': sku,
      $expr: { $gte: [availableExpr(sku), quantity] }
    },
    { $inc: { 'variants.$.reserved': quantity } },
    { new: true, session }
  );
  if (session) query.session(session);
  const product = await query;

  if (product) return product;

  const existing = await Product.findById(productId);
  if (!existing) throw ApiError.notFound('Product');
  if (existing.status !== 'active' || existing.supplierStatus !== 'available') {
    throw new ApiError(409, ERROR_CODES.PRODUCT_UNAVAILABLE, `"${existing.title}" is currently unavailable`);
  }
  const variant = existing.variants.find((item) => item.sku === sku);
  if (!variant || !variant.isActive) {
    throw new ApiError(409, ERROR_CODES.PRODUCT_UNAVAILABLE, `Variant "${sku}" is currently unavailable`);
  }
  throw new ApiError(
    409,
    ERROR_CODES.INSUFFICIENT_STOCK,
    `Insufficient stock for "${existing.title}" (${sku}). Available: ${Math.max(0, variant.stock - variant.reserved)}`
  );
};

export const releaseVariantStock = async (productId, sku, quantity) => {
  const result = await Product.updateOne(
    { _id: productId, 'variants.sku': sku, 'variants.reserved': { $gte: quantity } },
    { $inc: { 'variants.$.reserved': -quantity } }
  );
  return result.modifiedCount > 0;
};

/**
 * Converts a reservation into a stock decrement when payment is confirmed.
 * Returns the updated product, or null when stock could not be committed.
 */
export const commitVariantStock = async (productId, sku, quantity) => {
  return Product.findOneAndUpdate(
    {
      _id: productId,
      'variants.sku': sku,
      'variants.stock': { $gte: quantity },
      'variants.reserved': { $gte: quantity }
    },
    { $inc: { 'variants.$.stock': -quantity, 'variants.$.reserved': -quantity, stock: -quantity } },
    { new: true }
  );
};

/**
 * Puts stock back after a cancellation or return. Used only for stock that was
 * already committed (decremented); reserved-but-unpaid stock is released
 * through releaseVariantStock instead.
 */
export const restockVariant = async ({ productId, sku, quantity, reference = {}, note = '', createdBy = null }) => {
  const product = await Product.findOneAndUpdate(
    { _id: productId, 'variants.sku': sku },
    { $inc: { 'variants.$.stock': quantity, stock: quantity } },
    { new: true }
  );
  if (!product) throw ApiError.notFound('Product variant');

  const variant = product.variants.find((item) => item.sku === sku);
  await recordInventoryTransaction({
    productId: product._id,
    sku,
    type: 'restock',
    quantity,
    previousStock: Math.max(0, (variant?.stock || 0) - quantity),
    newStock: variant?.stock || 0,
    reference,
    note: note || 'Stock restored',
    createdBy
  });

  return product;
};

export const recordInventoryTransaction = async ({
  productId,
  sku,
  type,
  quantity,
  previousStock,
  newStock,
  reference = {},
  note = '',
  createdBy = null
}) =>
  InventoryTransaction.create({
    product: productId,
    variantSku: sku,
    type,
    quantity,
    previousStock,
    newStock,
    reference: { kind: reference.kind || '', id: reference.id || null },
    note,
    createdBy
  });

export const listInventory = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};

  if (query.supplierId) filter.supplier = query.supplierId;
  if (query.q) {
    const regex = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ title: regex }, { supplierSku: regex }, { 'variants.sku': regex }];
  }
  if (query.lowStock === 'true') {
    filter.variants = { $elemMatch: { stock: { $lte: query.threshold } } };
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ title: 1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'supplier', select: 'name code isMock' },
        { path: 'category', select: 'name slug' }
      ]),
    Product.countDocuments(filter)
  ]);

  return { products, meta: buildPaginationMeta({ page, limit, total }) };
};

export const listInventoryTransactions = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.productId) filter.product = query.productId;
  if (query.sku) filter.variantSku = query.sku;
  if (query.type) filter.type = query.type;

  const [transactions, total] = await Promise.all([
    InventoryTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'product', select: 'title slug supplierSku' }),
    InventoryTransaction.countDocuments(filter)
  ]);

  return { transactions, meta: buildPaginationMeta({ page, limit, total }) };
};

export const adjustVariantStock = async ({ productId, sku, stock, adjustment, note, adminId }) => {
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product');

  const variant = product.variants.find((item) => item.sku === sku);
  if (!variant) throw ApiError.notFound('Variant');

  const previousStock = variant.stock;
  const newStock = stock !== undefined ? Number(stock) : previousStock + Number(adjustment);

  if (!Number.isFinite(newStock) || newStock < 0) {
    throw ApiError.badRequest('Stock cannot be negative');
  }
  if (newStock < (variant.reserved || 0)) {
    throw ApiError.badRequest(`Stock cannot be lower than the reserved quantity (${variant.reserved})`);
  }

  variant.stock = newStock;
  product.stock = product.variants.reduce((sum, item) => sum + (item.stock || 0), 0);
  await product.save();

  await recordInventoryTransaction({
    productId: product._id,
    sku,
    type: 'admin_adjustment',
    quantity: newStock - previousStock,
    previousStock,
    newStock,
    reference: { kind: 'admin_adjustment' },
    note: note || 'Manual inventory adjustment',
    createdBy: adminId
  });

  return {
    productId: product._id,
    sku,
    previousStock,
    newStock,
    reserved: variant.reserved,
    note: note || 'Manual inventory adjustment'
  };
};
