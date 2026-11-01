import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { logger } from '../src/config/logger.js';
import { Supplier } from '../src/models/Supplier.js';
import { Product } from '../src/models/Product.js';
import { Coupon } from '../src/models/Coupon.js';
import { createSupplier } from '../src/modules/suppliers/suppliers.service.js';
import { syncCatalogue } from '../src/modules/suppliers/catalogueSync.service.js';
import { createCoupon } from '../src/modules/coupons/coupons.service.js';

const SUPPLIER_CODE = 'demo-mock-supplier';

const ensureMockSupplier = async () => {
  const existing = await Supplier.findOne({ code: SUPPLIER_CODE });
  if (existing) {
    logger.info({ supplierId: String(existing._id) }, 'Demo mock supplier already exists');
    return existing;
  }
  const supplier = await createSupplier({
    name: 'Mock Supplier (Demo)',
    code: SUPPLIER_CODE,
    description:
      'Local, clearly labelled mock supplier for development. Every response is marked mock:true and no external service is contacted.',
    adapterType: 'mock',
    config: {},
    isActive: true
  });
  logger.info({ supplierId: String(supplier._id) }, 'Created demo mock supplier');
  return supplier;
};

const importCatalogue = async (supplier) => {
  const result = await syncCatalogue(supplier._id, { triggeredBy: 'system' });
  logger.info({ stats: result.stats }, 'Demo catalogue imported');

  const activated = await Product.updateMany(
    { supplier: supplier._id, status: 'draft' },
    { $set: { status: 'active' } }
  );
  if (activated.modifiedCount > 0) {
    logger.info({ activated: activated.modifiedCount }, 'Activated imported demo products');
  }
  return result;
};

const ensureWelcomeCoupon = async () => {
  const existing = await Coupon.findOne({ code: 'WELCOME10' });
  if (existing) {
    logger.info({ code: 'WELCOME10' }, 'Demo coupon already exists');
    return existing;
  }
  const coupon = await createCoupon({
    code: 'WELCOME10',
    description: 'Demo coupon: 10% off orders above ₹499 (max ₹200)',
    discountType: 'percent',
    discountValue: 10,
    maxDiscount: 200,
    minOrderValue: 499,
    scope: 'all',
    perUserLimit: 1,
    usageLimit: 0,
    isActive: true
  });
  logger.info({ code: coupon.code }, 'Created demo coupon WELCOME10');
  return coupon;
};

const seed = async () => {
  await connectDatabase();
  const supplier = await ensureMockSupplier();
  const result = await importCatalogue(supplier);
  const coupon = await ensureWelcomeCoupon();

  const [products, activeProducts] = await Promise.all([
    Product.countDocuments({ supplier: supplier._id }),
    Product.countDocuments({ supplier: supplier._id, status: 'active' })
  ]);

  logger.info(
    {
      supplier: { id: String(supplier._id), code: supplier.code, isMock: true },
      catalogue: result.stats,
      products,
      activeProducts,
      coupon: coupon.code,
      paymentsMode: env.PAYMENTS_MOCK_MODE ? 'mock' : 'razorpay'
    },
    'Demo data ready. All supplier and payment data is mock/demo only.'
  );

  await disconnectDatabase();
};

seed().catch(async (error) => {
  logger.error({ err: error }, 'Demo seeding failed');
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
