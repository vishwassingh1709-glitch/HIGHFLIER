import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    image: {
      url: { type: String, trim: true, default: '' },
      alt: { type: String, trim: true, maxlength: 200, default: '' }
    },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } }
);

categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ parentCategory: 1, isActive: 1 });

export const Category = mongoose.model('Category', categorySchema);
