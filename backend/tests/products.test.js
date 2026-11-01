import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  app,
  API,
  authHeader,
  createAdmin,
  createMockSupplier,
  createProduct,
  unique
} from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { Product } from '../src/models/Product.js';

describe('products, categories, brands and pricing', () => {
  let admin;
  let supplier;

  beforeAll(async () => {
    await setupTestDatabase();
    await Product.init();
  });
  afterAll(teardownTestDatabase);
  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    supplier = await createMockSupplier();
  });

  const createCategory = async (name) => {
    const response = await request(app)
      .post(`${API}/admin/categories`)
      .set(authHeader(admin))
      .send({ name })
      .expect(201);
    return response.body.data.category;
  };

  const createBrand = async (name) => {
    const response = await request(app)
      .post(`${API}/admin/brands`)
      .set(authHeader(admin))
      .send({ name })
      .expect(201);
    return response.body.data.brand;
  };

  it('creates categories and brands with unique slugs', async () => {
    const category = await createCategory('Home & Kitchen');
    expect(category.slug).toBe('home-kitchen');

    const brand = await createBrand('Acme Living');
    expect(brand.slug).toBe('acme-living');

    const duplicate = await request(app)
      .post(`${API}/admin/categories`)
      .set(authHeader(admin))
      .send({ name: 'Home & Kitchen' })
      .expect(201);
    expect(duplicate.body.data.category.slug).toBe('home-kitchen-2');

    const categories = await request(app).get(`${API}/categories`).expect(200);
    expect(categories.body.data.categories.length).toBe(2);
    const brands = await request(app).get(`${API}/brands`).expect(200);
    expect(brands.body.data.brands.length).toBe(1);
  });

  it('lists only purchasable products publicly with filters and sorting', async () => {
    const category = await createCategory('Electronics');
    const brand = await createBrand('NovaTech');
    const cheap = await createProduct({
      supplier,
      overrides: { title: 'Cheap Speaker', sellingPrice: 199, category: category._id, brand: brand._id, ratingAverage: 4.5, ratingCount: 12 }
    });
    const expensive = await createProduct({
      supplier,
      overrides: { title: 'Expensive Headphones', sellingPrice: 899, category: category._id, brand: brand._id, ratingAverage: 4.9, ratingCount: 30 }
    });
    await createProduct({ supplier, overrides: { title: 'Draft Product', status: 'draft' } });
    await createProduct({ supplier, overrides: { title: 'Unavailable Product', supplierStatus: 'unavailable' } });

    const all = await request(app).get(`${API}/products`).expect(200);
    expect(all.body.data.products).toHaveLength(2);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data.products[0].supplierCost).toBeUndefined();
    expect(all.body.data.products[0].variants[0].supplierCost).toBeUndefined();

    const filtered = await request(app)
      .get(`${API}/products?category=${category.slug}&brand=${brand.slug}&minPrice=500&maxPrice=1000`)
      .expect(200);
    expect(filtered.body.data.products).toHaveLength(1);
    expect(filtered.body.data.products[0]._id).toBe(expensive._id.toString());

    const sorted = await request(app).get(`${API}/products?sort=price_asc`).expect(200);
    expect(sorted.body.data.products[0]._id).toBe(cheap._id.toString());

    const outOfStock = await request(app).get(`${API}/products?inStock=true`).expect(200);
    expect(outOfStock.body.data.products).toHaveLength(2);

    const search = await request(app).get(`${API}/products?q=Headphones`).expect(200);
    expect(search.body.data.products).toHaveLength(1);

    const invalidRange = await request(app).get(`${API}/products?minPrice=100&maxPrice=50`).expect(400);
    expect(invalidRange.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns product details by slug or id and hides drafts', async () => {
    const product = await createProduct({ supplier });
    const bySlug = await request(app).get(`${API}/products/${product.slug}`).expect(200);
    expect(bySlug.body.data.product.title).toBe(product.title);

    const byId = await request(app).get(`${API}/products/${product._id}`).expect(200);
    expect(byId.body.data.product._id).toBe(product._id.toString());

    product.status = 'draft';
    await product.save();
    await request(app).get(`${API}/products/${product.slug}`).expect(404);
  });

  it('lets admins update prices, images and activation state', async () => {
    const product = await createProduct({ supplier });
    const sku = product.variants[0].sku;

    const updated = await request(app)
      .patch(`${API}/admin/products/${product._id}`)
      .set(authHeader(admin))
      .send({
        title: 'Updated Product Name',
        images: [{ url: 'https://placehold.co/600x600?text=Updated', isPrimary: true }],
        variantPrices: { [sku]: 175.5 }
      })
      .expect(200);

    expect(updated.body.data.product.title).toBe('Updated Product Name');
    expect(updated.body.data.product.images[0].url).toContain('Updated');
    expect(updated.body.data.product.sellingPrice).toBe(175.5);

    const stored = await Product.findById(product._id);
    const variant = stored.variants.find((entry) => entry.sku === sku);
    expect(variant.isPriceLocked).toBe(true);
    expect(variant.sellingPrice).toBe(175.5);

    const draft = await createProduct({ supplier, overrides: { status: 'draft' } });
    await request(app).get(`${API}/products/${draft.slug}`).expect(404);
    await request(app)
      .post(`${API}/admin/products/${draft._id}/activate`)
      .set(authHeader(admin))
      .expect(200);
    await request(app).get(`${API}/products/${draft.slug}`).expect(200);

    const adminList = await request(app)
      .get(`${API}/admin/products?status=draft`)
      .set(authHeader(admin))
      .expect(200);
    expect(adminList.body.meta.total).toBe(0);
  });

  it('validates product updates and discontinues products', async () => {
    const product = await createProduct({ supplier });

    const empty = await request(app)
      .patch(`${API}/admin/products/${product._id}`)
      .set(authHeader(admin))
      .send({})
      .expect(422);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const badPrice = await request(app)
      .patch(`${API}/admin/products/${product._id}`)
      .set(authHeader(admin))
      .send({ variantPrices: { 'does-not-exist': 100 } })
      .expect(400);
    expect(badPrice.body.error.message).toMatch(/does not exist/i);

    await request(app)
      .delete(`${API}/admin/products/${product._id}`)
      .set(authHeader(admin))
      .expect(200);
    const stored = await Product.findById(product._id);
    expect(stored.status).toBe('discontinued');
    await request(app).get(`${API}/products/${product.slug}`).expect(404);
  });

  it('requires admin role for catalogue management', async () => {
    const product = await createProduct({ supplier });
    await request(app)
      .patch(`${API}/admin/products/${product._id}`)
      .send({ title: 'Nope' })
      .expect(401);
  });
});
