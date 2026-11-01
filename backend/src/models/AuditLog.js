import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, maxlength: 30, default: '' },
    action: { type: String, required: true, maxlength: 80, index: true },
    entityType: { type: String, required: true, maxlength: 60, index: true },
    entityId: { type: String, maxlength: 80, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, maxlength: 80, default: '' },
    userAgent: { type: String, maxlength: 300, default: '' },
    requestId: { type: String, maxlength: 100, default: '' }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
