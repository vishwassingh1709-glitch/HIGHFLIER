import mongoose from 'mongoose';

const inventoryTransactionSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantSku: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: ['import', 'sync', 'reservation', 'release', 'commit', 'admin_adjustment', 'return', 'restock'],
      required: true
    },
    quantity: { type: Number, required: true },
    previousStock: { type: Number, required: true, min: 0 },
    newStock: { type: Number, required: true, min: 0 },
    reference: {
      kind: { type: String, maxlength: 60, default: '' },
      id: { type: mongoose.Schema.Types.ObjectId, default: null }
    },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

inventoryTransactionSchema.index({ product: 1, createdAt: -1 });
inventoryTransactionSchema.index({ type: 1, createdAt: -1 });
inventoryTransactionSchema.index({ variantSku: 1, createdAt: -1 });

export const InventoryTransaction = mongoose.model('InventoryTransaction', inventoryTransactionSchema);
