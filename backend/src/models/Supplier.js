import mongoose from 'mongoose';
import { DEFAULT_SUPPLIER_CAPABILITIES, SUPPLIER_ADAPTER_TYPES } from '../constants/supplier.js';

const capabilitiesSchema = new mongoose.Schema(
  {
    catalogue: { type: Boolean, default: false },
    pricing: { type: Boolean, default: false },
    inventory: { type: Boolean, default: false },
    orderPlacement: { type: Boolean, default: false },
    orderStatus: { type: Boolean, default: false },
    tracking: { type: Boolean, default: false },
    cancellation: { type: Boolean, default: false },
    returns: { type: Boolean, default: false },
    cod: { type: Boolean, default: false },
    serviceability: { type: Boolean, default: false }
  },
  { _id: false }
);

const markupRuleSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    value: { type: Number, min: 0, default: 35 },
    minMarginPercent: { type: Number, min: 0, max: 100, default: 0 }
  },
  { _id: false }
);

const encryptedCredentialsSchema = new mongoose.Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: Number, default: 1 }
  },
  { _id: false }
);

const connectionTestSchema = new mongoose.Schema(
  {
    at: { type: Date },
    ok: { type: Boolean },
    message: { type: String, maxlength: 500 },
    mode: { type: String, maxlength: 40 }
  },
  { _id: false }
);

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    baseUrl: { type: String, trim: true, default: '' },
    allowedHosts: { type: [String], default: [] },
    adapterType: {
      type: String,
      enum: Object.values(SUPPLIER_ADAPTER_TYPES),
      required: true,
      default: SUPPLIER_ADAPTER_TYPES.MOCK
    },
    isMock: { type: Boolean, default: false },
    // Encrypted at rest with AES-256-GCM. Never returned by any API.
    credentials: { type: encryptedCredentialsSchema, select: false },
    credentialsMeta: {
      configured: { type: Boolean, default: false },
      keys: { type: [String], default: [] },
      updatedAt: { type: Date, default: null }
    },
    // Non-secret adapter configuration supplied from official supplier docs:
    // endpoint paths, auth style, pagination and field mappings.
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    capabilities: { type: capabilitiesSchema, default: () => ({ ...DEFAULT_SUPPLIER_CAPABILITIES }) },
    markupRule: { type: markupRuleSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true },
    lastSyncAt: { type: Date, default: null },
    lastConnectionTest: { type: connectionTestSchema, default: () => ({}) },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        delete ret.credentials;
        return ret;
      }
    }
  }
);

supplierSchema.index({ isActive: 1, adapterType: 1 });

export const Supplier = mongoose.model('Supplier', supplierSchema);
