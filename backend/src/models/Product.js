import mongoose from 'mongoose';

const productImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value) => /^https?:\/\/.+/i.test(value),
        message: 'Image URL must start with http:// or https://'
      }
    },
    publicId: { type: String, trim: true, default: '' },
    alt: { type: String, trim: true, maxlength: 200, default: '' },
    isPrimary: { type: Boolean, default: false }
  },
  { _id: false }
);

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, maxlength: 120 },
    supplierVariantId: { type: String, trim: true, default: '', maxlength: 120 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    supplierCost: { type: Number, required: true, min: 0 },
    mrp: { type: Number, min: 0, default: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isPriceLocked: { type: Boolean, default: false }
  },
  { _id: true }
);

variantSchema.virtual('availableStock').get(function availableStock() {
  return Math.max(0, (this.stock || 0) - (this.reserved || 0));
});

variantSchema.set('toJSON', { virtuals: true });

const productSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierProductId: { type: String, required: true, trim: true, maxlength: 120 },
    supplierSku: { type: String, trim: true, default: '', maxlength: 120 },
    title: { type: String, required: true, trim: true, maxlength: 250 },
    slug: { type: String, required: true, unique: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 10000, default: '' },
    shortDescription: { type: String, trim: true, maxlength: 300, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null },
    images: { type: [productImageSchema], default: [] },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    variants: {
      type: [variantSchema],
      validate: {
        validator: (variants) => Array.isArray(variants) && variants.length > 0,
        message: 'A product must have at least one variant'
      }
    },
    supplierCost: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, min: 0, default: 0 },
    stock: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    status: {
      type: String,
      enum: ['draft', 'active', 'inactive', 'discontinued'],
      default: 'draft',
      index: true
    },
    supplierStatus: {
      type: String,
      enum: ['available', 'unavailable', 'stale', 'discontinued'],
      default: 'available'
    },
    imported: { type: Boolean, default: true },
    tags: { type: [String], default: [] },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    salesCount: { type: Number, default: 0, min: 0 },
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

productSchema.index({ supplier: 1, supplierProductId: 1 }, { unique: true });
productSchema.index({ status: 1, supplierStatus: 1, category: 1, brand: 1 });
productSchema.index({ sellingPrice: 1 });
productSchema.index({ lastSyncedAt: 1 });
productSchema.index({ 'variants.sku': 1 });
productSchema.index(
  { title: 'text', description: 'text', tags: 'text', supplierSku: 'text' },
  { weights: { title: 10, supplierSku: 5, tags: 3, description: 1 }, name: 'product_text_search' }
);

productSchema.virtual('totalStock').get(function totalStock() {
  return (this.variants || []).reduce((sum, variant) => sum + (variant.stock || 0), 0);
});

productSchema.virtual('availableStock').get(function availableStock() {
  return (this.variants || []).reduce(
    (sum, variant) => sum + Math.max(0, (variant.stock || 0) - (variant.reserved || 0)),
    0
  );
});

productSchema.virtual('inStock').get(function inStock() {
  return this.availableStock > 0;
});

export const Product = mongoose.model('Product', productSchema);
export { variantSchema, productImageSchema };
