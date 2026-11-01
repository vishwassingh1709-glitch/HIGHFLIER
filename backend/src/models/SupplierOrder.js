import mongoose from 'mongoose';
import { SUPPLIER_ORDER_STATUS_VALUES } from '../constants/supplier.js';

const supplierOrderItemSchema = new mongoose.Schema(
  {
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplierProductId: { type: String, default: '', maxlength: 120 },
    supplierSku: { type: String, default: '', maxlength: 120 },
    supplierVariantId: { type: String, default: '', maxlength: 120 },
    sku: { type: String, required: true, maxlength: 120 },
    title: { type: String, default: '', maxlength: 250 },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    supplierCost: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const supplierOrderHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, maxlength: 1000, default: '' },
    source: { type: String, enum: ['system', 'admin', 'supplier', 'webhook'], default: 'system' },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const supplierOrderSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    orderNumber: { type: String, required: true, maxlength: 40 },
    supplierOrderId: { type: String, default: '', maxlength: 160 },
    status: {
      type: String,
      enum: SUPPLIER_ORDER_STATUS_VALUES,
      default: 'pending_submission',
      index: true
    },
    statusHistory: { type: [supplierOrderHistorySchema], default: [] },
    items: { type: [supplierOrderItemSchema], default: [] },
    supplierCost: { type: Number, default: 0, min: 0 },
    idempotencyKey: { type: String, required: true, unique: true, maxlength: 128 },
    attempts: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    nextRetryAt: { type: Date, default: null, index: true },
    submittedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    lastError: { type: String, maxlength: 2000, default: '' },
    retryable: { type: Boolean, default: true },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    responsePayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    rawStatus: { type: String, maxlength: 120, default: '' },
    tracking: {
      courier: { type: String, maxlength: 120, default: '' },
      trackingNumber: { type: String, maxlength: 120, default: '' },
      trackingUrl: { type: String, maxlength: 2000, default: '' },
      updatedAt: { type: Date, default: null },
      isMock: { type: Boolean, default: false }
    },
    isMock: { type: Boolean, default: false },
    lastSyncedAt: { type: Date, default: null }
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

supplierOrderSchema.index({ status: 1, nextRetryAt: 1 });
supplierOrderSchema.index({ supplier: 1, createdAt: -1 });
supplierOrderSchema.index({ createdAt: -1 });

supplierOrderSchema.virtual('needsAttention').get(function needsAttention() {
  return ['failed', 'action_required'].includes(this.status);
});

export const SupplierOrder = mongoose.model('SupplierOrder', supplierOrderSchema);
