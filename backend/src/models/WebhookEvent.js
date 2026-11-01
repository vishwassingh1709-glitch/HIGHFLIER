import mongoose from 'mongoose';

const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['razorpay', 'mock'], required: true },
    eventId: { type: String, required: true, maxlength: 160 },
    eventType: { type: String, required: true, maxlength: 120 },
    signatureVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['received', 'processed', 'ignored', 'failed'], default: 'received' },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, maxlength: 1000, default: '' },
    processedAt: { type: Date, default: null }
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ createdAt: -1 });

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
