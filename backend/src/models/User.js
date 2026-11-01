import mongoose from 'mongoose';
import { ROLES, ROLE_VALUES } from '../constants/roles.js';

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 40, default: 'Home' },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^(\+91[\s-]?)?[6-9]\d{9}$/, 'Phone must be a valid Indian mobile number']
    },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200, default: '' },
    landmark: { type: String, trim: true, maxlength: 100, default: '' },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    pincode: { type: String, required: true, trim: true, match: [/^\d{6}$/, 'Pincode must be 6 digits'] },
    country: { type: String, trim: true, default: 'India', maxlength: 60 },
    isDefault: { type: Boolean, default: false }
  },
  { _id: true, timestamps: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is invalid']
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_VALUES, default: ROLES.CUSTOMER, index: true },
    phone: {
      type: String,
      trim: true,
      default: undefined,
      match: [/^(\+91[\s-]?)?[6-9]\d{9}$/, 'Phone must be a valid Indian mobile number']
    },
    addresses: { type: [addressSchema], default: [] },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        delete ret.passwordHash;
        return ret;
      }
    }
  }
);

userSchema.index({ createdAt: -1 });

userSchema.virtual('defaultAddress').get(function defaultAddress() {
  if (!this.addresses?.length) return null;
  return this.addresses.find((address) => address.isDefault) || this.addresses[0];
});

export const User = mongoose.model('User', userSchema);
export const addressSubSchema = addressSchema;
