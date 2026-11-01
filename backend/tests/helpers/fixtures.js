import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Supplier } from '../../src/models/Supplier.js';
import { Product } from '../../src/models/Product.js';
import { Order } from '../../src/models/Order.js';
import { Coupon } from '../../src/models/Coupon.js';
import { hashPassword } from '../../src/utils/password.js';
import { signAccessToken } from '../../src/utils/jwt.js';
import { ROLES } from '../../src/constants/roles.js';
import { MOCK_SUPPLIER_CAPABILITIES } from '../../src/modules/suppliers/adapters/mockAdapter.js';

export const TEST_PASSWORD = 'Password123';
export const API = '/api/v1';

let sequence = 0;
export const unique = (prefix = 'x') => `${prefix}-${Date.now()}-${++sequence}`;

export const app = createApp();

export const sampleAddress = (overrides = {}) => ({
  label: 'Home',
  fullName: 'Test Customer',
  phone: '9876543210',
  line1: '10 Test Street',
  line2: 'Indiranagar',
  landmark: 'Near Metro',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  country: 'India',
  isDefault: true,
  ...overrides
});

export const createUser = async ({
  role = ROLES.CUSTOMER,
  password = TEST_PASSWORD,
  name = 'Test User',
  email,
  phone = '9876543210',
  addresses = []
} = {}) =>
  User.create({
    name,
    email: email || `${unique('user')}@example.com`,
    passwordHash: await hashPassword(password),
    role,
    phone,
    emailVerified: true,
    emailVerifiedAt: new Date(),
    addresses
  });

export const createAdmin = async (overrides = {}) => createUser({ ...overrides, role: ROLES.ADMIN });

export const authHeader = (user) => ({ Authorization: `Bearer ${signAccessToken(user)}` });

export const addAddress = async (user, overrides = {}) => {
  user.addresses.push(sampleAddress(overrides));
  await user.save();
  return user.addresses[user.addresses.length - 1];
};

export const createMockSupplier = async (overrides = {}) =>
  Supplier.create({
    name: `Mock Supplier ${unique('s')}`,
    code: unique('mock').toLowerCase(),
    adapterType: 'mock',
    isMock: true,
    capabilities: { ...MOCK_SUPPLIER_CAPABILITIES },
    config: { mockTimelineSeconds: { processing: 0, shipped: 0, delivered: 0 } },
    markupRule: { type: 'percent', value: 35, minMarginPercent: 0 },
    ...overrides
  });

export const createProduct = async ({ supplier, overrides = {} } = {}) => {
  const supplierDoc = supplier || (await createMockSupplier());
  const id = unique('prod');
  return Product.create({
    supplier: supplierDoc._id,
    supplierProductId: id,
    supplierSku: id.toUpperCase(),
    title: `Test Product ${id}`,
    slug: `test-product-${id}`,
    description: 'Fictional test product used by the automated test suite.',
    supplierCost: 100,
    sellingPrice: 150,
    mrp: 200,
    stock: 20,
    status: 'active',
    supplierStatus: 'available',
    images: [{ url: 'https://placehold.co/800x800?text=Test', alt: 'Test', isPrimary: true }],
    variants: [
      {
        sku: `${id}-SKU`,
        supplierVariantId: `${id}-VID`,
        name: 'Default',
        supplierCost: 100,
        sellingPrice: 150,
        mrp: 200,
        stock: 20
      }
    ],
    ...overrides
  });
};

export const createCoupon = async (overrides = {}) =>
  Coupon.create({
    code: unique('COUPON').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40),
    discountType: 'percent',
    discountValue: 10,
    usageLimit: 0,
    perUserLimit: 1,
    isActive: true,
    ...overrides
  });

export const createDeliveredOrder = async ({ user, product, supplier, quantity = 1, status = 'delivered' }) => {
  const lineTotal = product.sellingPrice * quantity;
  const orderNumber = `HF-${Date.now()}-${++sequence}`;
  return Order.create({
    orderNumber,
    user: user._id,
    items: [
      {
        product: product._id,
        supplier: supplier._id,
        supplierProductId: product.supplierProductId,
        supplierSku: product.supplierSku,
        title: product.title,
        slug: product.slug,
        image: product.images?.[0]?.url || '',
        variantSku: product.variants[0].sku,
        variantName: product.variants[0].name,
        unitPrice: product.sellingPrice,
        unitMrp: product.mrp,
        supplierCost: product.supplierCost,
        quantity,
        lineTotal
      }
    ],
    shippingAddress: sampleAddress(),
    subtotal: lineTotal,
    total: lineTotal,
    amountPaid: lineTotal,
    paymentMethod: 'online',
    paymentStatus: 'captured',
    status,
    stockReserved: true,
    stockCommitted: true,
    paidAt: new Date(),
    deliveredAt: status === 'delivered' ? new Date() : null,
    statusHistory: [{ status, note: 'Test fixture', actorType: 'system' }]
  });
};

export const placeOrder = ({ user, items, paymentMethod = 'cod', couponCode, extras = {} }) =>
  request(app)
    .post(`${API}/orders/checkout`)
    .set(authHeader(user))
    .send({ items, paymentMethod, ...(couponCode ? { couponCode } : {}), ...extras });

export const orderItem = (product, sku, quantity = 1) => ({
  productId: product._id.toString(),
  sku: sku || product.variants[0].sku,
  quantity
});
