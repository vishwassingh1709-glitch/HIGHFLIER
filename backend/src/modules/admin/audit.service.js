import { AuditLog } from '../../models/AuditLog.js';
import { logger } from '../../config/logger.js';

/**
 * Writes an immutable admin audit record. Never include secrets, credentials,
 * payment signatures or full personal data in metadata.
 */
export const recordAudit = async ({ req = null, actor = null, action, entityType, entityId = '', metadata = {} }) => {
  try {
    await AuditLog.create({
      actor: actor || req?.user?._id || null,
      actorRole: req?.user?.role || '',
      action,
      entityType,
      entityId: String(entityId || ''),
      metadata,
      ip: req?.ip || req?.socket?.remoteAddress || '',
      userAgent: String(req?.get?.('user-agent') || '').slice(0, 300),
      requestId: req?.id || ''
    });
  } catch (error) {
    logger.warn({ err: error, action, entityType }, 'Audit log write failed');
  }
};
