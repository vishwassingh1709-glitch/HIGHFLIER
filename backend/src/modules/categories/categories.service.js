import { ApiError } from '../../utils/ApiError.js';
import { Category } from '../../models/Category.js';
import { Product } from '../../models/Product.js';
import { slugify } from '../../utils/slugify.js';

const uniqueSlug = async (name, excludeId = null) => {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (await Category.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
};

const assertParentIsValid = async (categoryId, parentId) => {
  if (!parentId) return;
  if (categoryId && String(parentId) === String(categoryId)) {
    throw ApiError.badRequest('A category cannot be its own parent');
  }

  const parent = await Category.findById(parentId);
  if (!parent) throw ApiError.badRequest('Parent category does not exist');

  if (!categoryId) return;

  let current = parent;
  let depth = 0;
  while (current?.parentCategory && depth < 25) {
    if (String(current.parentCategory) === String(categoryId)) {
      throw ApiError.badRequest('Category hierarchy would create a cycle');
    }
    current = await Category.findById(current.parentCategory);
    depth += 1;
  }
};

const productCountsByCategory = async () => {
  const rows = await Product.aggregate([
    { $match: { status: 'active', supplierStatus: 'available', category: { $ne: null } } },
    { $group: { _id: '$category', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

export const listCategories = async ({ includeInactive = false } = {}) => {
  const categories = await Category.find(includeInactive ? {} : { isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const counts = await productCountsByCategory();

  return categories.map((category) => ({
    ...category,
    productCount: counts.get(String(category._id)) || 0
  }));
};

export const getCategoryBySlug = async (slug) => {
  const category = await Category.findOne({ slug, isActive: true }).populate({
    path: 'parentCategory',
    select: 'name slug'
  });
  if (!category) throw ApiError.notFound('Category');

  const children = await Category.find({ parentCategory: category._id, isActive: true }).select('name slug image sortOrder');
  const counts = await productCountsByCategory();

  return {
    ...category.toJSON(),
    productCount: counts.get(String(category._id)) || 0,
    children
  };
};

export const createCategory = async (payload) => {
  await assertParentIsValid(null, payload.parentCategory);
  const slug = await uniqueSlug(payload.name);

  return Category.create({
    ...payload,
    parentCategory: payload.parentCategory || null,
    slug
  });
};

export const updateCategory = async (id, payload) => {
  const category = await Category.findById(id);
  if (!category) throw ApiError.notFound('Category');

  await assertParentIsValid(id, payload.parentCategory);

  if (payload.name !== undefined) category.name = payload.name;
  if (payload.description !== undefined) category.description = payload.description;
  if (payload.parentCategory !== undefined) category.parentCategory = payload.parentCategory || null;
  if (payload.image !== undefined) category.image = payload.image;
  if (payload.isActive !== undefined) category.isActive = payload.isActive;
  if (payload.sortOrder !== undefined) category.sortOrder = payload.sortOrder;

  await category.save();
  return category;
};

export const deactivateCategory = async (id) => {
  const category = await Category.findById(id);
  if (!category) throw ApiError.notFound('Category');

  category.isActive = false;
  await category.save();

  return { message: 'Category deactivated. Existing products are preserved.' };
};
