import mongoose from 'mongoose';
import { ORDER_STATUS_VALUES } from '../constants/orderStatus.js';
import { PAYMENT_METHOD_VALUES, PAYMENT_STATUS_VALUES } from '../constants/payment.js';

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierProductId: { type: String, default: '', maxlength: 120 },
    supplierSku: { type: String, default: '', maxlength: 120 },
    supplierVariantId: { type: String, default: '', maxlength: 120 },
    title: { type: String, required: true, maxlength: 250 },
    slug: { type: String, default: '', maxlength: 160 },
    image: { type: String, default: '', maxlength: 2000 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    variantSku: { type: String, required: true, maxlength: 120 },
    variantName: { type: String, default: '', maxlength: 120 },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    unitPrice: { type: Number, required: true, min: 0 },
    unitMrp: { type: Number, min: 0, default: 0 },
    supplierCost: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
    isMockSupplier: { type: Boolean, default: false }
  },
  { _id: true }
);

const orderAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, maxlength: 100 },
    phone: { type: String, required: true, maxlength: 20 },
    line1: { type: String, required: true, maxlength: 200 },
    line2: { type: String, default: '', maxlength: 200 },
    landmark: { type: String, default: '', maxlength: 100 },
    city: { type: String, required: true, maxlength: 100 },
    state: { type: String, required: true, maxlength: 100 },
    pincode: { type: String, required: true, maxlength: 10 },
    country: { type: String, default: 'India', maxlength: 60 }
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, maxlength: 500, default: '' },
    at: { type: Date, default: Date.now },
    actorType: { type: String, enum: ['customer', 'admin', 'system', 'supplier'], default: 'system' },
    actor: { type: mongoose.Schema.Types.ObjectId, default: null }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, maxlength: 40 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'An order must contain at least one item'
      }
    },
    shippingAddress: { type: orderAddressSchema, required: true },
    shippingAddressId: { type: mongoose.Schema.Types.ObjectId, default: null },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    codFee: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    amountRefunded: { type: Number, default: 0, min: 0 },
    paymentReference: { type: String, default: '', maxlength: 120 },
    coupon: {
      couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
      code: { type: String, default: '', maxlength: 40 },
      discount: { type: Number, default: 0, min: 0 }
    },
    paymentMethod: { type: String, enum: PAYMENT_METHOD_VALUES, required: true },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUS_VALUES,
      default: 'pending'
    },
    status: { type: String, enum: ORDER_STATUS_VALUES, required: true, default: 'pending_payment' },
    statusHistory: { type: [statusHistorySchema], default: [] },
    stockReserved: { type: Boolean, default: false },
    stockCommitted: { type: Boolean, default: false },
    reservationExpiresAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, maxlength: 500, default: '' },
    cancelledBy: { type: String, enum: ['customer', 'admin', 'system', 'supplier', 'expired', null], default: null },
    returnRequest: {
      status: {
        type: String,
        enum: ['none', 'requested', 'approved', 'rejected', 'completed'],
        default: 'none'
      },
      reason: { type: String, maxlength: 500, default: '' },
      note: { type: String, maxlength: 1000, default: '' },
      requestedAt: { type: Date, default: null },
      resolvedAt: { type: Date, default: null },
      resolutionNote: { type: String, maxlength: 1000, default: '' }
    },
    tracking: {
      courier: { type: String, maxlength: 120, default: '' },
      trackingNumber: { type: String, maxlength: 120, default: '' },
      trackingUrl: { type: String, maxlength: 2000, default: '' },
      updatedAt: { type: Date, default: null },
      isMock: { type: Boolean, default: false }
    },
    supplierOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SupplierOrder' }],
    fulfilmentIssue: {
      required: { type: Boolean, default: false },
      message: { type: String, maxlength: 1000, default: '' },
      at: { type: Date, default: null }
    },
    hasMockSupplier: { type: Boolean, default: false },
    customerNote: { type: String, maxlength: 1000, default: '' },
    adminNote: { type: String, maxlength: 1000, default: '' },
    idempotencyKey: { type: String, maxlength: 128, default: null }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'items.supplier': 1 });
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
orderSchema.index({ status: 1, reservationExpiresAt: 1 });

orderSchema.virtual('itemCount').get(function itemCount() {
  return (this.items || []).reduce((sum, item) => sum + item.quantity, 0);
});

export const Order = mongoose.model('Order', orderSchema);
export { orderItemSchema, orderAddressSchema };
