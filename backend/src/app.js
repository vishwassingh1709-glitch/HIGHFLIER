import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { requestId } from './middleware/requestId.js';
import { sanitizeRequest } from './middleware/sanitize.js';
import { globalRateLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { mountDocs } from './docs/docs.routes.js';
import { apiRouter } from './routes.js';
import { healthRouter } from './modules/health.routes.js';
import { ApiError } from './utils/ApiError.js';

const captureRawBody = (req, _res, buffer) => {
  if (req.originalUrl?.startsWith('/api/v1/payments/webhook')) {
    req.rawBody = Buffer.from(buffer);
  }
};

export const createCorsOptions = (runtimeEnv = env) => ({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // Postman, server-to-server, Razorpay webhooks
    if (runtimeEnv.corsOrigins.includes(origin)) return callback(null, true);
    if (runtimeEnv.isDevelopment && origin === 'http://localhost:5000') return callback(null, true);
    if (runtimeEnv.isTest) return callback(null, true);
    return callback(ApiError.forbidden(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'X-Razorpay-Signature'],
  exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy']
});

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: !env.isTest,
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress };
        },
        res(res) {
          return { statusCode: res.statusCode };
        }
      }
    })
  );

  app.use(
    helmet({
      contentSecurityPolicy: false, // Swagger UI loads its own assets
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );
  app.use(cors(createCorsOptions()));
  app.use(compression());
  app.use(express.json({ limit: '1mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeRequest);

  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'HIGHFLIER Backend API',
        version: '1.0.0',
        docs: '/api-docs',
        health: '/health',
        apiBase: '/api/v1'
      }
    });
  });

  app.use('/health', healthRouter);
  mountDocs(app);

  app.use('/api/v1', globalRateLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
