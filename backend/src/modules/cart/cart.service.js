import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { Cart } from '../../models/Cart.js';
import { Product } from '../../models/Product.js';
import { roundMoney } from '../../utils/money.js';

const MAX_CART_LINES = 50;
const PRODUCT_POPULATE = [
  { path: 'category', select: 'name slug' },
  { path: 'brand', select: 'name slug' },
  { path: 'supplier', select: 'name code isMock isActive' }
];

const getOrCreateCart = async (userId) =>
  Cart.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId, items: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const findVariant = (product, sku) => (product.variants || []).find((variant) => variant.sku === sku);

const assertPurchasable = (product, variant, quantity) => {
  if (!product || product.status !== 'active' || product.supplierStatus !== 'available') {
    throw new ApiError(409, ERROR_CODES.PRODUCT_UNAVAILABLE, 'This product is currently unavailable');
  }
  if (!variant || !variant.isActive) {
    throw new ApiError(409, ERROR_CODES.PRODUCT_UNAVAILABLE, 'This variant is currently unavailable');
  }
  const available = Math.max(0, (variant.stock || 0) - (variant.reserved || 0));
  if (available < quantity) {
    throw new ApiError(
      409,
      ERROR_CODES.INSUFFICIENT_STOCK,
      `Only ${available} unit(s) available for ${product.title} (${variant.sku})`
    );
  }
};

const buildProductSummary = (product) => {
  if (!product) return null;
  const json = product.toJSON ? product.toJSON() : product;
  return {
    _id: json._id,
    title: json.title,
    slug: json.slug,
    status: json.status,
    supplierStatus: json.supplierStatus,
    images: (json.images || []).filter((image) => image.isPrimary).concat((json.images || []).filter((image) => !image.isPrimary)).slice(0, 2),
    category: json.category,
    brand: json.brand,
    supplier: json.supplier
      ? { _id: json.supplier._id, name: json.supplier.name, code: json.supplier.code, isMock: json.supplier.isMock }
      : null
  };
};

/**
 * Loads the cart with live product data. Prices and availability are always
 * recalculated on the server so a stale cart can never dictate checkout totals.
 */
export const getCart = async (userId) => {
  const cart = await getOrCreateCart(userId);
  await cart.populate({ path: 'items.product', populate: PRODUCT_POPULATE });

  const items = [];
  let subtotal = 0;
  let itemCount = 0;

  for (const item of cart.items) {
    const product = item.product;
    const variant = product ? findVariant(product, item.sku) : null;
    const available = variant ? Math.max(0, (variant.stock || 0) - (variant.reserved || 0)) : 0;
    const unitPrice = variant ? roundMoney(variant.sellingPrice) : 0;
    const lineTotal = roundMoney(unitPrice * item.quantity);
    const purchasable = Boolean(
      product &&
        product.status === 'active' &&
        product.supplierStatus === 'available' &&
        variant &&
        variant.isActive &&
        available >= item.quantity
    );

    if (purchasable) {
      subtotal = roundMoney(subtotal + lineTotal);
      itemCount += item.quantity;
    }

    items.push({
      product: buildProductSummary(product),
      variant: variant
        ? {
            sku: variant.sku,
            name: variant.name,
            attributes: variant.attributes || {},
            unitPrice,
            availableStock: available,
            isActive: variant.isActive
          }
        : null,
      quantity: item.quantity,
      lineTotal,
      available,
      isPurchasable: purchasable,
      issue: purchasable
        ? null
        : !variant
          ? 'Variant no longer exists'
          : !variant.isActive
            ? 'Variant is inactive'
            : product?.status !== 'active' || product?.supplierStatus !== 'available'
              ? 'Product is unavailable'
              : `Only ${available} unit(s) available`
    });
  }

  return {
    _id: cart._id,
    items,
    itemCount,
    lineCount: items.length,
    subtotal,
    currency: 'INR'
  };
};

export const addItem = async (userId, { productId, sku, quantity }) => {
  const [cart, product] = await Promise.all([getOrCreateCart(userId), Product.findById(productId)]);
  if (!product) throw ApiError.notFound('Product');

  const variant = findVariant(product, sku);
  const existing = cart.items.find((item) => String(item.product) === String(productId) && item.sku === sku);
  const newQuantity = (existing?.quantity || 0) + quantity;

  assertPurchasable(product, variant, newQuantity);

  if (existing) {
    existing.quantity = newQuantity;
  } else {
    if (cart.items.length >= MAX_CART_LINES) {
      throw ApiError.badRequest(`A cart can contain at most ${MAX_CART_LINES} different items`);
    }
    cart.items.push({ product: productId, sku, quantity });
  }

  await cart.save();
  return getCart(userId);
};

export const updateItem = async (userId, productId, sku, quantity) => {
  const cart = await getOrCreateCart(userId);
  const index = cart.items.findIndex(
    (item) => String(item.product) === String(productId) && item.sku === sku
  );
  if (index === -1) throw ApiError.notFound('Cart item');

  if (quantity === 0) {
    cart.items.splice(index, 1);
    await cart.save();
    return getCart(userId);
  }

  const product = await Product.findById(productId);
  if (!product) {
    cart.items.splice(index, 1);
    await cart.save();
    return getCart(userId);
  }

  assertPurchasable(product, findVariant(product, sku), quantity);
  cart.items[index].quantity = quantity;
  await cart.save();
  return getCart(userId);
};

export const removeItem = async (userId, productId, sku) => {
  await Cart.updateOne({ user: userId }, { $pull: { items: { product: productId, sku } } });
  return getCart(userId);
};

export const clearCart = async (userId) => {
  const cart = await getOrCreateCart(userId);
  cart.items = [];
  await cart.save();
  return getCart(userId);
};

export const clearCartInternal = async (userId) => {
  await Cart.updateOne({ user: userId }, { $set: { items: [] } });
};

export const listCartItemsForCheckout = async (userId) => {
  const cart = await getOrCreateCart(userId);
  return cart.items.map((item) => ({
    productId: item.product,
    sku: item.sku,
    quantity: item.quantity
  }));
};
