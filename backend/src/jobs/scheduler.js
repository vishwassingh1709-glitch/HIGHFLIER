import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger as baseLogger } from '../config/logger.js';
import { Supplier } from '../models/Supplier.js';
import { syncCatalogue } from '../modules/suppliers/catalogueSync.service.js';
import { syncInventory } from '../modules/suppliers/inventorySync.service.js';
import { retryDueSupplierOrders, syncActiveSupplierOrders } from '../modules/suppliers/supplierOrder.service.js';
import { expirePendingReservations } from '../modules/orders/orderLifecycle.service.js';

const logger = baseLogger.child({ component: 'jobs' });
const TIMEZONE = 'Asia/Kolkata';

/** @type {Map<string, {name: string, cronExpression: string, handler: Function, task: any}>} */
const jobs = new Map();
let started = false;

const runSafely = (name, handler) => async () => {
  const startedAt = Date.now();
  logger.info({ job: name }, 'Job started');
  try {
    const result = await handler();
    logger.info({ job: name, durationMs: Date.now() - startedAt }, 'Job finished');
    return result;
  } catch (error) {
    logger.error({ err: error, job: name, durationMs: Date.now() - startedAt }, 'Job failed');
    return undefined;
  }
};

const loadSyncableSuppliers = (capability) =>
  Supplier.find({ isActive: true, [`capabilities.${capability}`]: true }).select('_id name');

const runCatalogueSync = async () => {
  const suppliers = await loadSyncableSuppliers('catalogue');
  const summary = { suppliers: suppliers.length, succeeded: 0, failed: 0 };

  for (const supplier of suppliers) {
    try {
      await syncCatalogue(supplier._id, { triggeredBy: 'cron', userId: null, requestId: '' });
      summary.succeeded += 1;
    } catch (error) {
      summary.failed += 1;
      logger.warn({ err: error, supplierId: String(supplier._id) }, 'Scheduled catalogue sync failed');
    }
  }
  return summary;
};

const runInventorySync = async () => {
  const suppliers = await loadSyncableSuppliers('inventory');
  const summary = { suppliers: suppliers.length, succeeded: 0, failed: 0 };

  for (const supplier of suppliers) {
    try {
      await syncInventory(supplier._id, {
        triggeredBy: 'cron',
        userId: null,
        requestId: '',
        markMissingUnavailable: false
      });
      summary.succeeded += 1;
    } catch (error) {
      summary.failed += 1;
      logger.warn({ err: error, supplierId: String(supplier._id) }, 'Scheduled inventory sync failed');
    }
  }
  return summary;
};

const runSupplierOrderRetries = async () => retryDueSupplierOrders({ limit: 50 });

const runSupplierStatusSync = async () => syncActiveSupplierOrders({ limit: 100 });

const runReservationExpiry = async () => expirePendingReservations({ limit: 200 });

const registerDefaults = () => {
  const defaults = [
    ['catalogue-sync', env.CATALOGUE_SYNC_CRON, runCatalogueSync],
    ['inventory-sync', env.INVENTORY_SYNC_CRON, runInventorySync],
    ['supplier-order-retry', env.SUPPLIER_ORDER_RETRY_CRON, runSupplierOrderRetries],
    ['supplier-status-sync', env.SUPPLIER_STATUS_SYNC_CRON, runSupplierStatusSync],
    ['reservation-expiry', env.RESERVATION_EXPIRY_CRON, runReservationExpiry]
  ];

  for (const [name, expression, handler] of defaults) {
    if (!jobs.has(name)) jobs.set(name, { name, cronExpression: expression, handler, task: null });
  }
};

/**
 * Registers an extra cron job. Built-in jobs are registered by startJobs().
 * Safe to call repeatedly with the same name (last registration wins) before start.
 */
export const registerJob = (name, cronExpression, handler) => {
  if (typeof handler !== 'function') throw new TypeError(`Job "${name}" handler must be a function`);
  jobs.set(name, { name, cronExpression, handler, task: null });
  return name;
};

export const listJobs = () =>
  [...jobs.values()].map((job) => ({
    name: job.name,
    cronExpression: job.cronExpression,
    running: Boolean(job.task)
  }));

export const startJobs = async () => {
  if (started) return listJobs();
  if (!env.JOBS_ENABLED) {
    logger.info('Job scheduler disabled (JOBS_ENABLED=false)');
    return [];
  }

  registerDefaults();

  for (const job of jobs.values()) {
    if (!cron.validate(job.cronExpression)) {
      logger.error({ job: job.name, cron: job.cronExpression }, 'Invalid cron expression; job not scheduled');
      continue;
    }
    job.task = cron.schedule(job.cronExpression, runSafely(job.name, job.handler), {
      scheduled: true,
      timezone: TIMEZONE
    });
    logger.info({ job: job.name, cron: job.cronExpression, timezone: TIMEZONE }, 'Scheduled job');
  }

  started = true;
  return listJobs();
};

export const stopJobs = async () => {
  for (const job of jobs.values()) {
    if (!job.task) continue;
    if (typeof job.task.destroy === 'function') job.task.destroy();
    else job.task.stop();
    job.task = null;
  }
  started = false;
  logger.info('Job scheduler stopped');
};
