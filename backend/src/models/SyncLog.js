import mongoose from 'mongoose';
import { SYNC_LOG_STATUS, SYNC_LOG_TYPES } from '../constants/supplier.js';

const syncLogSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    type: { type: String, enum: Object.values(SYNC_LOG_TYPES), required: true },
    status: { type: String, enum: Object.values(SYNC_LOG_STATUS), required: true },
    message: { type: String, maxlength: 1000, default: '' },
    stats: {
      total: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 }
    },
    errors: {
      type: [
        {
          _id: false,
          message: { type: String, maxlength: 1000 },
          sku: { type: String, maxlength: 120 },
          context: { type: String, maxlength: 300 }
        }
      ],
      default: []
    },
    triggeredBy: { type: String, enum: ['manual', 'cron', 'webhook', 'system'], default: 'manual' },
    triggeredByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestId: { type: String, maxlength: 100, default: '' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null }
  },
  { timestamps: true, toJSON: { versionKey: false }, suppressReservedKeysWarning: true }
);

syncLogSchema.index({ supplier: 1, createdAt: -1 });
syncLogSchema.index({ type: 1, status: 1, createdAt: -1 });

export const SyncLog = mongoose.model('SyncLog', syncLogSchema);
