import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase } from '../../src/config/db.js';
import { resetMockSupplierState } from '../../src/modules/suppliers/adapters/mockAdapter.js';
import { clearMailOutbox } from '../../src/modules/auth/mailer.service.js';

let memoryServer = null;

export const setupTestDatabase = async () => {
  memoryServer = await MongoMemoryServer.create();
  await connectDatabase(memoryServer.getUri(), { dbName: 'highflier_test' });
};

export const resetDatabase = async () => {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
  resetMockSupplierState();
  clearMailOutbox();
};

export const teardownTestDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
};
