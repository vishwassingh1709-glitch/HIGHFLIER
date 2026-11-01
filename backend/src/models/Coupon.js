import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    discountType: { type: String, enum: ['percent', 'fixed'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscount: { type: Number, min: 0, default: 0 },
    minOrderValue: { type: Number, min: 0, default: 0 },
    scope: { type: String, enum: ['all', 'category', 'product'], default: 'all' },
    categories: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    products: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    usageLimit: { type: Number, min: 0, default: 0 }, // 0 = unlimited
    perUserLimit: { type: Number, min: 0, default: 1 }, // 0 = unlimited per user
    usedCount: { type: Number, min: 0, default: 0 },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
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

couponSchema.index({ isActive: 1, expiresAt: 1 });

export const Coupon = mongoose.model('Coupon', couponSchema);
