import mongoose from 'mongoose';
import { PAYMENT_METHOD_VALUES, PAYMENT_STATUS_VALUES, REFUND_STATUS } from '../constants/payment.js';

const refundSchema = new mongoose.Schema(
  {
    providerRefundId: { type: String, default: '', maxlength: 120 },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: Object.values(REFUND_STATUS), default: REFUND_STATUS.PENDING },
    reason: { type: String, maxlength: 500, default: '' },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    failureReason: { type: String, maxlength: 500, default: '' }
  },
  { _id: true }
);

const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['razorpay', 'mock', 'cod'], required: true },
    method: { type: String, enum: PAYMENT_METHOD_VALUES, required: true },
    providerOrderId: { type: String, default: '', maxlength: 120 },
    providerPaymentId: { type: String, default: '', maxlength: 120 },
    providerSignature: { type: String, default: '', maxlength: 300 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    status: { type: String, enum: PAYMENT_STATUS_VALUES, default: 'pending' },
    isMock: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    capturedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, maxlength: 500, default: '' },
    signatureVerified: { type: Boolean, default: false },
    refunds: { type: [refundSchema], default: [] },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, maxlength: 128, default: null }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        delete ret.__v;
        delete ret.providerSignature;
        return ret;
      }
    }
  }
);

paymentSchema.index({ providerOrderId: 1 }, { sparse: true });
paymentSchema.index({ providerPaymentId: 1 }, { sparse: true });
paymentSchema.index({ order: 1, status: 1 });
paymentSchema.index({ createdAt: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
