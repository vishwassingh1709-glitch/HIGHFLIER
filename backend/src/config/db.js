import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);
// Query-filter sanitisation is handled by middleware/sanitize.js. Mongoose's
// global sanitizeFilter option would disable the $expr conditions used for
// atomic stock reservation and coupon usage limits.

let isConnected = false;

export const getMongoConnectionDiagnostic = (error) => {
  const serverErrors = [...(error?.reason?.servers?.values?.() || [])].map((server) => server.error);
  if (
    serverErrors.some((serverError) =>
      /tls(?:v\d+(?:\.\d+)?)?\s+alert|ssl routines|ERR_SSL/i.test(
        `${serverError?.code || ''} ${serverError?.message || ''}`
      )
    )
  ) {
    return 'MongoDB SRV DNS resolved, but the TLS handshake failed. Check that the current public egress IP is in the Atlas IP access list and that the network or VPN permits unmodified MongoDB TLS traffic.';
  }
  if (error?.name === 'MongooseServerSelectionError') {
    return 'MongoDB SRV DNS resolved, but no Atlas server was selected. Check the Atlas IP access list and outbound TCP access to port 27017.';
  }
  return undefined;
};

export const connectDatabase = async (uri = env.MONGODB_URI, options = {}) => {
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return mongoose.connection;
  }

  await mongoose.connect(uri, {
    dbName: env.MONGODB_DB_NAME || undefined,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
    ...options
  });

  isConnected = true;
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    isConnected = true;
    logger.info('MongoDB reconnected');
  });
  mongoose.connection.on('error', (error) => {
    logger.error({ err: error }, 'MongoDB connection error');
  });

  return mongoose.connection;
};

export const disconnectDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected (shutdown)');
  }
};

export const isDatabaseConnected = () => isConnected && mongoose.connection.readyState === 1;

export const databaseState = () => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting', 'uninitialized'];
  return states[mongoose.connection.readyState] || 'unknown';
};

/**
 * Runs a callback inside a transaction when the deployment supports it
 * (MongoDB replica set / Atlas). Falls back to a plain callback on standalone
 * servers where transactions are unavailable.
 */
export const withTransaction = async (callback) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } catch (error) {
    if (error?.codeName === 'IllegalOperation' || /Transaction numbers are only allowed/.test(error?.message || '')) {
      logger.warn('Transactions unsupported by this MongoDB deployment; using non-transactional path');
      return callback(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
