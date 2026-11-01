import { SyncLog } from '../../models/SyncLog.js';
import { SYNC_LOG_STATUS } from '../../constants/supplier.js';

export const createSyncLog = async ({
  supplier,
  type,
  status = SYNC_LOG_STATUS.STARTED,
  message = '',
  stats = {},
  errors = [],
  triggeredBy = 'manual',
  triggeredByUser = null,
  requestId = '',
  startedAt = new Date(),
  finishedAt = null
}) => {
  const log = await SyncLog.create({
    supplier,
    type,
    status,
    message: String(message || '').slice(0, 1000),
    stats: {
      total: stats.total || 0,
      created: stats.created || 0,
      updated: stats.updated || 0,
      skipped: stats.skipped || 0,
      failed: stats.failed || 0
    },
    errors: (errors || []).slice(0, 50).map((error) => ({
      message: String(error.message || '').slice(0, 1000),
      sku: String(error.sku || '').slice(0, 120),
      context: String(error.context || '').slice(0, 300)
    })),
    triggeredBy,
    triggeredByUser,
    requestId,
    startedAt,
    finishedAt
  });

  return log;
};

export const finishSyncLog = async (logId, { status, message = '', stats, errors, finishedAt = new Date() }) => {
  const update = { status, message: String(message || '').slice(0, 1000), finishedAt };
  if (stats) update.stats = stats;
  if (errors) {
    update.errors = errors.slice(0, 50).map((error) => ({
      message: String(error.message || '').slice(0, 1000),
      sku: String(error.sku || '').slice(0, 120),
      context: String(error.context || '').slice(0, 300)
    }));
  }
  return SyncLog.findByIdAndUpdate(logId, { $set: update }, { new: true });
};
