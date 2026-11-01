import { ApiError } from '../../utils/ApiError.js';
import { Brand } from '../../models/Brand.js';
import { Product } from '../../models/Product.js';
import { slugify } from '../../utils/slugify.js';

const uniqueSlug = async (name, excludeId = null) => {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (await Brand.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
};

const productCountsByBrand = async () => {
  const rows = await Product.aggregate([
    { $match: { status: 'active', supplierStatus: 'available', brand: { $ne: null } } },
    { $group: { _id: '$brand', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

export const listBrands = async ({ includeInactive = false } = {}) => {
  const brands = await Brand.find(includeInactive ? {} : { isActive: true }).sort({ name: 1 }).lean();
  const counts = await productCountsByBrand();
  return brands.map((brand) => ({ ...brand, productCount: counts.get(String(brand._id)) || 0 }));
};

export const getBrandBySlug = async (slug) => {
  const brand = await Brand.findOne({ slug, isActive: true });
  if (!brand) throw ApiError.notFound('Brand');
  return brand;
};

export const createBrand = async (payload) => {
  const slug = await uniqueSlug(payload.name);
  return Brand.create({ ...payload, slug });
};

export const updateBrand = async (id, payload) => {
  const brand = await Brand.findById(id);
  if (!brand) throw ApiError.notFound('Brand');

  if (payload.name !== undefined) brand.name = payload.name;
  if (payload.description !== undefined) brand.description = payload.description;
  if (payload.logo !== undefined) brand.logo = payload.logo;
  if (payload.isActive !== undefined) brand.isActive = payload.isActive;

  await brand.save();
  return brand;
};

export const deactivateBrand = async (id) => {
  const brand = await Brand.findById(id);
  if (!brand) throw ApiError.notFound('Brand');
  brand.isActive = false;
  await brand.save();
  return { message: 'Brand deactivated. Existing products are preserved.' };
};
