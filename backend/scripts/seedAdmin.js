import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { ROLES } from '../src/constants/roles.js';
import { hashPassword } from '../src/utils/password.js';
import { logger } from '../src/config/logger.js';

const seed = async () => {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env before seeding an admin user.');
  }
  if (env.ADMIN_PASSWORD.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
  }

  await connectDatabase();

  const existing = await User.findOne({ email: env.ADMIN_EMAIL });
  if (existing) {
    existing.role = ROLES.ADMIN;
    existing.isActive = true;
    existing.emailVerified = true;
    existing.emailVerifiedAt = existing.emailVerifiedAt || new Date();
    existing.passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await existing.save();
    logger.info({ email: env.ADMIN_EMAIL }, 'Existing admin user updated');
  } else {
    await User.create({
      name: env.ADMIN_NAME,
      email: env.ADMIN_EMAIL,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: ROLES.ADMIN,
      emailVerified: true,
      emailVerifiedAt: new Date()
    });
    logger.info({ email: env.ADMIN_EMAIL }, 'Admin user created');
  }

  await disconnectDatabase();
};

seed().catch(async (error) => {
  logger.error({ err: error }, 'Admin seeding failed');
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
