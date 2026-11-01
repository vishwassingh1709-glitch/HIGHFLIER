import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { User } from '../../models/User.js';
import { Session } from '../../models/Session.js';
import { Order } from '../../models/Order.js';
import { Product } from '../../models/Product.js';
import { Supplier } from '../../models/Supplier.js';
import { SupplierOrder } from '../../models/SupplierOrder.js';
import { SyncLog } from '../../models/SyncLog.js';
import { WebhookEvent } from '../../models/WebhookEvent.js';
import { AuditLog } from '../../models/AuditLog.js';
import { ROLES } from '../../constants/roles.js';
import { PAYMENT_STATUS } from '../../constants/payment.js';
import { buildPaginationMeta, parsePagination } from '../../utils/http.js';
import { escapeRegex } from '../../utils/slugify.js';
import { roundMoney } from '../../utils/money.js';
import { recordAudit } from './audit.service.js';

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const countByStatus = async (Model, match = {}) => {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  return rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
};

export const getDashboard = async () => {
  const today = startOfToday();
  const [
    totalUsers,
    activeUsers,
    newUsersToday,
    totalProducts,
    activeProducts,
    lowStockProducts,
    totalOrders,
    ordersToday,
    orderStatusCounts,
    revenueAgg,
    todayRevenueAgg,
    supplierOrderStatusCounts,
    totalSuppliers,
    activeSuppliers,
    recentOrders,
    recentSyncLogs,
    pendingPayments,
    actionRequiredSupplierOrders
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ createdAt: { $gte: today } }),
    Product.countDocuments({}),
    Product.countDocuments({ status: 'active' }),
    Product.countDocuments({ status: 'active', variants: { $elemMatch: { stock: { $lte: 5 } } } }),
    Order.countDocuments({}),
    Order.countDocuments({ createdAt: { $gte: today } }),
    countByStatus(Order),
    Order.aggregate([
      {
        $match: {
          status: { $nin: ['cancelled'] },
          paymentStatus: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED] }
        }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$amountPaid' },
          refunded: { $sum: '$amountRefunded' },
          paidOrders: { $sum: 1 }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: today },
          status: { $nin: ['cancelled'] },
          paymentStatus: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED] }
        }
      },
      { $group: { _id: null, revenue: { $sum: '$amountPaid' }, orders: { $sum: 1 } } }
    ]),
    countByStatus(SupplierOrder),
    Supplier.countDocuments({}),
    Supplier.countDocuments({ isActive: true }),
    Order.find({}).sort({ createdAt: -1 }).limit(5).populate({ path: 'user', select: 'name email' }),
    SyncLog.find({}).sort({ createdAt: -1 }).limit(5).populate({ path: 'supplier', select: 'name code isMock' }),
    Order.countDocuments({ paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CREATED] } }),
    SupplierOrder.countDocuments({ status: { $in: ['failed', 'action_required'] } })
  ]);

  const revenue = revenueAgg[0] || { revenue: 0, refunded: 0, paidOrders: 0 };
  const todayRevenue = todayRevenueAgg[0] || { revenue: 0, orders: 0 };

  return {
    users: { total: totalUsers, active: activeUsers, newToday: newUsersToday },
    products: { total: totalProducts, active: activeProducts, lowStock: lowStockProducts },
    suppliers: { total: totalSuppliers, active: activeSuppliers },
    orders: {
      total: totalOrders,
      today: ordersToday,
      byStatus: orderStatusCounts,
      pendingPayment: pendingPayments
    },
    revenue: {
      grossPaid: roundMoney(revenue.revenue || 0),
      refunded: roundMoney(revenue.refunded || 0),
      net: roundMoney((revenue.revenue || 0) - (revenue.refunded || 0)),
      paidOrders: revenue.paidOrders || 0,
      today: roundMoney(todayRevenue.revenue || 0),
      todayOrders: todayRevenue.orders || 0,
      averageOrderValue:
        revenue.paidOrders > 0 ? roundMoney((revenue.revenue - revenue.refunded) / revenue.paidOrders) : 0
    },
    supplierOrders: {
      byStatus: supplierOrderStatusCounts,
      needsAttention: actionRequiredSupplierOrders
    },
    recentOrders,
    recentSyncLogs
  };
};

export const listUsers = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.q) {
    const regex = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);

  return { users, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getUser = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.notFound('User');
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User');

  const [orderCount, spendAgg] = await Promise.all([
    Order.countDocuments({ user: user._id }),
    Order.aggregate([
      {
        $match: {
          user: user._id,
          paymentStatus: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED] }
        }
      },
      { $group: { _id: null, total: { $sum: '$amountPaid' }, refunded: { $sum: '$amountRefunded' } } }
    ])
  ]);

  return {
    user,
    stats: {
      orders: orderCount,
      lifetimeValue: roundMoney((spendAgg[0]?.total || 0) - (spendAgg[0]?.refunded || 0))
    }
  };
};

const ensureNotLastAdmin = async (user, changes) => {
  const removesAdmin =
    user.role === ROLES.ADMIN && (changes.role === ROLES.CUSTOMER || changes.isActive === false);
  if (!removesAdmin) return;
  const otherAdmins = await User.countDocuments({
    _id: { $ne: user._id },
    role: ROLES.ADMIN,
    isActive: true
  });
  if (otherAdmins === 0) {
    throw ApiError.badRequest('At least one active admin account must remain');
  }
};

export const updateUser = async (id, payload, { req = null } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.notFound('User');
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User');

  if (req?.user?._id && String(req.user._id) === String(user._id) && payload.isActive === false) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  await ensureNotLastAdmin(user, payload);

  const mutable = ['name', 'phone', 'role', 'isActive'];
  const changes = {};
  for (const key of mutable) {
    if (payload[key] !== undefined) {
      user[key] = payload[key];
      changes[key] = payload[key];
    }
  }
  await user.save();

  if (changes.isActive === false) {
    await Session.deleteMany({ user: user._id });
  }

  await recordAudit({
    req,
    action: 'user.update',
    entityType: 'user',
    entityId: user._id,
    metadata: changes
  });

  return user;
};

export const revokeUserSessions = async (id, { req = null } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.notFound('User');
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User');
  const result = await Session.deleteMany({ user: user._id });
  await recordAudit({
    req,
    action: 'user.sessions_revoked',
    entityType: 'user',
    entityId: user._id,
    metadata: { deleted: result.deletedCount }
  });
  return { message: 'All sessions revoked', deleted: result.deletedCount };
};

const resolveRange = (query, defaultDays = 30) => {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw ApiError.badRequest('Invalid date range');
  if (from > to) throw ApiError.badRequest('from must be before to');
  return { from, to };
};

export const getSalesReport = async (query) => {
  const { from, to } = resolveRange(query);
  const match = {
    createdAt: { $gte: from, $lte: to },
    status: { $nin: ['cancelled'] },
    paymentStatus: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED] }
  };

  const [daily, totals] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } },
          revenue: { $sum: '$amountPaid' },
          refunded: { $sum: '$amountRefunded' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$amountPaid' },
          refunded: { $sum: '$amountRefunded' },
          orders: { $sum: 1 }
        }
      }
    ])
  ]);

  return {
    from,
    to,
    daily: daily.map((row) => ({
      date: row._id,
      revenue: roundMoney(row.revenue),
      refunded: roundMoney(row.refunded),
      net: roundMoney(row.revenue - row.refunded),
      orders: row.orders
    })),
    totals: {
      revenue: roundMoney(totals[0]?.revenue || 0),
      refunded: roundMoney(totals[0]?.refunded || 0),
      net: roundMoney((totals[0]?.revenue || 0) - (totals[0]?.refunded || 0)),
      orders: totals[0]?.orders || 0
    }
  };
};

export const getTopProducts = async (query) => {
  const { from, to } = resolveRange(query);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
  const match = {
    createdAt: { $gte: from, $lte: to },
    status: { $nin: ['cancelled'] },
    paymentStatus: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED] }
  };

  return Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        title: { $first: '$items.title' },
        slug: { $first: '$items.slug' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal' }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
    { $project: { _id: 0, productId: '$_id', title: 1, slug: 1, quantity: 1, revenue: { $round: ['$revenue', 2] } } }
  ]);
};

export const getLowStockReport = async (query) => {
  const threshold = Math.max(0, Number(query.threshold) || 5);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const products = await Product.find({
    status: 'active',
    variants: { $elemMatch: { isActive: true, stock: { $lte: threshold } } }
  })
    .sort({ stock: 1 })
    .limit(limit)
    .populate({ path: 'supplier', select: 'name code isMock' })
    .select('title slug stock variants supplier lastSyncedAt');

  return products.map((product) => ({
    productId: product._id,
    title: product.title,
    slug: product.slug,
    supplier: product.supplier,
    lastSyncedAt: product.lastSyncedAt,
    lowStockVariants: (product.variants || [])
      .filter((variant) => variant.isActive && variant.stock <= threshold)
      .map((variant) => ({
        sku: variant.sku,
        name: variant.name,
        stock: variant.stock,
        reserved: variant.reserved,
        available: Math.max(0, variant.stock - variant.reserved)
      }))
  }));
};

export const getSupplierPerformance = async () => {
  const [suppliers, statusRows] = await Promise.all([
    Supplier.find({}).select('name code isMock isActive lastSyncAt lastConnectionTest'),
    SupplierOrder.aggregate([
      {
        $group: {
          _id: '$supplier',
          total: { $sum: 1 },
          failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'action_required']] }, 1, 0] } },
          submitted: { $sum: { $cond: [{ $in: ['$status', ['submitted', 'accepted', 'processing', 'shipped', 'delivered']] }, 1, 0] } }
        }
      }
    ])
  ]);

  const statusMap = new Map(statusRows.map((row) => [String(row._id), row]));
  return suppliers.map((supplier) => {
    const stats = statusMap.get(String(supplier._id)) || { total: 0, failed: 0, submitted: 0 };
    return {
      supplierId: supplier._id,
      name: supplier.name,
      code: supplier.code,
      isMock: supplier.isMock,
      isActive: supplier.isActive,
      lastSyncAt: supplier.lastSyncAt,
      lastConnectionTest: supplier.lastConnectionTest,
      supplierOrders: { total: stats.total, submitted: stats.submitted, failed: stats.failed }
    };
  });
};

export const listAuditLogs = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 50, maxLimit: 200 });
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.actor) filter.actor = query.actor;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'actor', select: 'name email role' }),
    AuditLog.countDocuments(filter)
  ]);

  return { logs, meta: buildPaginationMeta({ page, limit, total }) };
};

export const listWebhookEvents = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 50, maxLimit: 200 });
  const filter = {};
  if (query.provider) filter.provider = query.provider;
  if (query.status) filter.status = query.status;
  if (query.eventType) filter.eventType = query.eventType;

  const [events, total] = await Promise.all([
    WebhookEvent.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WebhookEvent.countDocuments(filter)
  ]);

  return { events, meta: buildPaginationMeta({ page, limit, total }) };
};

export const listSyncLogs = async (query) => {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 50, maxLimit: 200 });
  const filter = {};
  if (query.supplierId) filter.supplier = query.supplierId;
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;

  const [logs, total] = await Promise.all([
    SyncLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'supplier', select: 'name code isMock' }),
    SyncLog.countDocuments(filter)
  ]);

  return { logs, meta: buildPaginationMeta({ page, limit, total }) };
};
