const locks = new Map();

export const isKeyLocked = (key) => locks.has(key);

/**
 * Simple in-process mutex. Prevents overlapping catalogue/inventory syncs for
 * the same supplier. For multi-instance deployments use a distributed lock
 * (e.g. Redis) in addition to this guard.
 */
export const withKeyLock = async (key, fn) => {
  if (locks.has(key)) {
    const error = new Error('Another operation is already running for this resource');
    error.code = 'LOCKED';
    throw error;
  }

  const promise = Promise.resolve().then(fn);
  locks.set(key, promise);
  try {
    return await promise;
  } finally {
    locks.delete(key);
  }
};
