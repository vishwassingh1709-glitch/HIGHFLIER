import mongoose from 'mongoose';

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    logo: {
      url: { type: String, trim: true, default: '' },
      publicId: { type: String, trim: true, default: '' },
      alt: { type: String, trim: true, maxlength: 200, default: '' }
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } }
);

brandSchema.index({ slug: 1 }, { unique: true });
brandSchema.index({ isActive: 1 });

export const Brand = mongoose.model('Brand', brandSchema);
