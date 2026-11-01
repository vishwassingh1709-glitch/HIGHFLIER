import express from 'express';
import { databaseState, isDatabaseConnected } from '../config/db.js';

export const healthRouter = express.Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'highflier-backend',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    }
  });
});

healthRouter.get('/ready', (_req, res) => {
  const ready = isDatabaseConnected();
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: {
      status: ready ? 'ready' : 'not_ready',
      database: databaseState(),
      timestamp: new Date().toISOString()
    }
  });
});
