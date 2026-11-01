import { ApiError } from '../../utils/ApiError.js';
import { Wishlist } from '../../models/Wishlist.js';
import { Product } from '../../models/Product.js';
import { toPublicProduct } from '../products/products.service.js';

const MAX_WISHLIST_ITEMS = 200;

const getOrCreate = async (userId) =>
  Wishlist.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId, products: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const PRODUCT_POPULATE = [
  { path: 'category', select: 'name slug' },
  { path: 'brand', select: 'name slug' },
  { path: 'supplier', select: 'name code isMock' }
];

export const getWishlist = async (userId) => {
  const wishlist = await getOrCreate(userId);
  await wishlist.populate({ path: 'products', populate: PRODUCT_POPULATE });

  const products = wishlist.products
    .filter(Boolean)
    .map((product) => {
      const publicProduct = toPublicProduct(product);
      return {
        _id: publicProduct._id,
        title: publicProduct.title,
        slug: publicProduct.slug,
        images: publicProduct.images,
        sellingPrice: publicProduct.sellingPrice,
        mrp: publicProduct.mrp,
        ratingAverage: publicProduct.ratingAverage,
        ratingCount: publicProduct.ratingCount,
        inStock: publicProduct.inStock,
        availableStock: publicProduct.availableStock,
        status: publicProduct.status,
        supplierStatus: publicProduct.supplierStatus,
        category: publicProduct.category,
        brand: publicProduct.brand,
        supplier: publicProduct.supplier
      };
    });

  return { _id: wishlist._id, products, count: products.length };
};

export const addProduct = async (userId, productId) => {
  const product = await Product.findOne({ _id: productId, status: 'active', supplierStatus: 'available' });
  if (!product) throw ApiError.notFound('Product');

  const wishlist = await getOrCreate(userId);
  if (wishlist.products.some((id) => String(id) === String(productId))) {
    return getWishlist(userId);
  }
  if (wishlist.products.length >= MAX_WISHLIST_ITEMS) {
    throw ApiError.badRequest(`A wishlist can contain at most ${MAX_WISHLIST_ITEMS} products`);
  }

  wishlist.products.push(product._id);
  await wishlist.save();
  return getWishlist(userId);
};

export const removeProduct = async (userId, productId) => {
  await Wishlist.updateOne({ user: userId }, { $pull: { products: productId } });
  return getWishlist(userId);
};

export const clearWishlist = async (userId) => {
  const wishlist = await getOrCreate(userId);
  wishlist.products = [];
  await wishlist.save();
  return getWishlist(userId);
};
