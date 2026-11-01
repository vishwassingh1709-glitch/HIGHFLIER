import { createApp } from './src/app.js';
import { env } from './src/config/env.js';
import { logger } from './src/config/logger.js';
import { connectDatabase, disconnectDatabase, getMongoConnectionDiagnostic } from './src/config/db.js';
import { startJobs, stopJobs } from './src/jobs/scheduler.js';

const start = async () => {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `HIGHFLIER API listening on ${env.API_BASE_URL}`);
  });

  await startJobs();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    await stopJobs();
    server.close(async () => {
      try {
        await disconnectDatabase();
      } finally {
        process.exit(0);
      }
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  return server;
};

start().catch((error) => {
  const diagnostic = getMongoConnectionDiagnostic(error);
  if (diagnostic) {
    logger.fatal({ errorName: error.name, errorCode: error.code }, diagnostic);
  } else {
    logger.fatal({ err: error }, 'Failed to start HIGHFLIER API');
  }
  process.exit(1);
});
