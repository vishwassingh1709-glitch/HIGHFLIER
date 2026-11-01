import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

export const mountDocs = (app) => {
  app.get('/api-docs.json', (_req, res) => res.json(openApiDocument));
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'HIGHFLIER API Docs',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true }
    })
  );
};
