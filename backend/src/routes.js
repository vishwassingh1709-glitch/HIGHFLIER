import { Router } from 'express';
import { healthRouter } from './modules/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { categoriesRouter, adminCategoriesRouter } from './modules/categories/categories.routes.js';
import { brandsRouter, adminBrandsRouter } from './modules/brands/brands.routes.js';
import { productsRouter, adminProductsRouter } from './modules/products/products.routes.js';
import { adminInventoryRouter } from './modules/inventory/inventory.routes.js';
import { adminSuppliersRouter } from './modules/suppliers/suppliers.routes.js';
import { adminSupplierOrdersRouter } from './modules/suppliers/supplierOrders.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { wishlistRouter } from './modules/wishlist/wishlist.routes.js';
import { ordersRouter, adminOrdersRouter } from './modules/orders/orders.routes.js';
import { couponsRouter, adminCouponsRouter } from './modules/coupons/coupons.routes.js';
import { paymentsRouter, adminPaymentsRouter } from './modules/payments/payments.routes.js';
import { reviewsRouter, adminReviewsRouter } from './modules/reviews/reviews.routes.js';
import { adminUploadsRouter } from './modules/uploads/uploads.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authenticate } from './middleware/auth.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/brands', brandsRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/reviews', reviewsRouter);

apiRouter.use('/cart', cartRouter);
apiRouter.use('/wishlist', wishlistRouter);
apiRouter.use('/orders', authenticate, ordersRouter);
apiRouter.use('/coupons', couponsRouter);
apiRouter.use('/payments', paymentsRouter);

apiRouter.use('/admin/suppliers', adminSuppliersRouter);
apiRouter.use('/admin/supplier-orders', adminSupplierOrdersRouter);
apiRouter.use('/admin/orders', adminOrdersRouter);
apiRouter.use('/admin/coupons', adminCouponsRouter);
apiRouter.use('/admin/payments', adminPaymentsRouter);
apiRouter.use('/admin/reviews', adminReviewsRouter);
apiRouter.use('/admin/uploads', adminUploadsRouter);
apiRouter.use('/admin/categories', adminCategoriesRouter);
apiRouter.use('/admin/brands', adminBrandsRouter);
apiRouter.use('/admin/products', adminProductsRouter);
apiRouter.use('/admin/inventory', adminInventoryRouter);
apiRouter.use('/admin', adminRouter);
