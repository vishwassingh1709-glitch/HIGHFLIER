import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { Product } from '../../models/Product.js';
import { Category } from '../../models/Category.js';
import { Brand } from '../../models/Brand.js';
import { escapeRegex } from '../../utils/slugify.js';
import { buildPaginationMeta, parsePagination } from '../../utils/http.js';
import { roundMoney } from '../../utils/money.js';
import { summarizeVariants } from './pricing.service.js';

const PUBLIC_POPULATE = [
  { path: 'category', select: 'name slug' },
  { path: 'brand', select: 'name slug logo' },
  { path: 'supplier', select: 'name code isMock' }
];

const ADMIN_POPULATE = [
  { path: 'category', select: 'name slug' },
  { path: 'brand', select: 'name slug' },
  { path: 'supplier', select: 'name code isMock adapterType isActive' }
];

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  price_asc: { sellingPrice: 1 },
  price_desc: { sellingPrice: -1 },
  rating: { ratingAverage: -1, ratingCount: -1 },
  popular: { salesCount: -1, ratingAverage: -1 },
  name_asc: { title: 1 }
};

/**
 * Removes confidential supplier cost data and internal fields from products
 * returned to customers.
 */
export const toPublicProduct = (product) => {
  const raw = product.toJSON ? product.toJSON() : product;
  delete raw.supplierCost;
  delete raw.supplierProductId;
  delete raw.supplierSku;
  delete raw.imported;

  raw.variants = (raw.variants || []).map((variant) => {
    const { supplierCost, supplierVariantId, isPriceLocked, reserved, ...safe } = variant;
    return { ...safe, availableStock: Math.max(0, (safe.stock || 0) - (reserved || 0)) };
  });

  if (raw.supplier && typeof raw.supplier === 'object') {
    raw.supplier = {
      _id: raw.supplier._id,
      name: raw.supplier.name,
      code: raw.supplier.code,
      isMock: raw.supplier.isMock
    };
  }
  return raw;
};

const resolveCategoryId = async (value) => {
  if (!value) return null;
  const category = mongoose.Types.ObjectId.isValid(value)
    ? await Category.findById(value)
    : await Category.findOne({ slug: value });
  if (!category) throw ApiError.notFound('Category');
  return category._id;
};

const resolveBrandId = async (value) => {
  if (!value) return null;
  const brand = mongoose.Types.ObjectId.isValid(value)
    ? await Brand.findById(value)
    : await Brand.findOne({ slug: value });
  if (!brand) throw ApiError.notFound('Brand');
  return brand._id;
};

const buildSearchFilter = (q) => {
  if (!q) return null;
  const regex = new RegExp(escapeRegex(q.slice(0, 100)), 'i');
  return {
    $or: [{ title: regex }, { description: regex }, { supplierSku: regex }, { tags: regex }, { 'variants.sku': regex }]
  };
};

export const listPublicProducts = async (query) => {
  if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
    throw ApiError.badRequest('minPrice cannot be greater than maxPrice');
  }

  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { status: 'active', supplierStatus: 'available' };

  if (query.category) filter.category = await resolveCategoryId(query.category);
  if (query.brand) filter.brand = await resolveBrandId(query.brand);
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.sellingPrice = {};
    if (query.minPrice !== undefined) filter.sellingPrice.$gte = query.minPrice;
    if (query.maxPrice !== undefined) filter.sellingPrice.$lte = query.maxPrice;
  }
  if (query.rating !== undefined) filter.ratingAverage = { $gte: query.rating };
  if (query.inStock === 'true') filter.stock = { $gt: 0 };

  const search = buildSearchFilter(query.q);
  if (search) Object.assign(filter, search);

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(SORT_MAP[query.sort] || SORT_MAP.newest)
      .skip(skip)
      .limit(limit)
      .populate(PUBLIC_POPULATE),
    Product.countDocuments(filter)
  ]);

  return {
    products: products.map(toPublicProduct),
    meta: buildPaginationMeta({ page, limit, total })
  };
};

export const getPublicProduct = async (identifier) => {
  const filter = mongoose.Types.ObjectId.isValid(identifier)
    ? { _id: identifier, status: 'active', supplierStatus: 'available' }
    : { slug: identifier, status: 'active', supplierStatus: 'available' };

  const product = await Product.findOne(filter).populate(PUBLIC_POPULATE);
  if (!product) throw ApiError.notFound('Product');
  return toPublicProduct(product);
};

export const listAdminProducts = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};

  if (query.status) filter.status = query.status;
  if (query.supplierStatus) filter.supplierStatus = query.supplierStatus;
  if (query.supplier) filter.supplier = query.supplier;
  if (query.category) filter.category = await resolveCategoryId(query.category);
  if (query.brand) filter.brand = await resolveBrandId(query.brand);
  if (query.lowStock === 'true') filter.variants = { $elemMatch: { stock: { $lte: 5 } } };

  const search = buildSearchFilter(query.q);
  if (search) Object.assign(filter, search);

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(SORT_MAP[query.sort] || SORT_MAP.newest)
      .skip(skip)
      .limit(limit)
      .populate(ADMIN_POPULATE),
    Product.countDocuments(filter)
  ]);

  return { products, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getAdminProduct = async (id) => {
  const product = await Product.findById(id).populate(ADMIN_POPULATE);
  if (!product) throw ApiError.notFound('Product');
  return product;
};

const normalizeProductImages = (images) => {
  const normalized = (images || []).map((image) => ({
    url: image.url,
    publicId: image.publicId || '',
    alt: image.alt || '',
    isPrimary: Boolean(image.isPrimary)
  }));
  if (normalized.length > 0 && !normalized.some((image) => image.isPrimary)) {
    normalized[0].isPrimary = true;
  }
  return normalized;
};

export const updateProduct = async (id, payload) => {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product');

  if (payload.category !== undefined) {
    if (payload.category) {
      const category = await Category.findById(payload.category);
      if (!category) throw ApiError.badRequest('Category does not exist');
      product.category = category._id;
    } else {
      product.category = null;
    }
  }

  if (payload.brand !== undefined) {
    if (payload.brand) {
      const brand = await Brand.findById(payload.brand);
      if (!brand) throw ApiError.badRequest('Brand does not exist');
      product.brand = brand._id;
    } else {
      product.brand = null;
    }
  }

  if (payload.title !== undefined) product.title = payload.title;
  if (payload.description !== undefined) product.description = payload.description;
  if (payload.shortDescription !== undefined) product.shortDescription = payload.shortDescription;
  if (payload.status !== undefined) product.status = payload.status;
  if (payload.images !== undefined) product.images = normalizeProductImages(payload.images);
  if (payload.tags !== undefined) product.tags = payload.tags;

  if (payload.variantPrices) {
    for (const [sku, price] of Object.entries(payload.variantPrices)) {
      const variant = product.variants.find((item) => item.sku === sku);
      if (!variant) throw ApiError.badRequest(`Variant "${sku}" does not exist`);
      variant.sellingPrice = roundMoney(price);
      variant.isPriceLocked = true;
      if (!variant.mrp || variant.mrp < variant.sellingPrice) variant.mrp = variant.sellingPrice;
    }
  }

  if (payload.variantActive) {
    for (const [sku, isActive] of Object.entries(payload.variantActive)) {
      const variant = product.variants.find((item) => item.sku === sku);
      if (!variant) throw ApiError.badRequest(`Variant "${sku}" does not exist`);
      variant.isActive = Boolean(isActive);
    }
  }

  const summary = summarizeVariants(product.variants);
  product.supplierCost = summary.supplierCost;
  product.sellingPrice = summary.sellingPrice;
  product.mrp = summary.mrp;
  product.stock = summary.stock;

  await product.save();
  return getAdminProduct(product._id);
};

export const setProductStatus = async (id, status) => {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product');
  product.status = status;
  await product.save();
  return getAdminProduct(product._id);
};

export const discontinueProduct = async (id) => {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product');
  product.status = 'discontinued';
  await product.save();
  return { message: 'Product marked as discontinued. Existing orders retain their snapshots.' };
};
