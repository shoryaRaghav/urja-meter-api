import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { sessionAuth } from './middleware/sessionAuth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { metersRouter } from './routes/meters.js';
import { transformersRouter } from './routes/transformers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiSpec = JSON.parse(readFileSync(path.join(__dirname, '..', 'openapi.json'), 'utf-8'));

export function createApp() {
  const app = express();

  // gzip response bodies over a small default threshold — mainly matters
  // for the bulk export (GET /api/meters/export), the one response large
  // enough for it to make a real difference.
  app.use(compression());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Interactive API docs, generated from openapi.json — not a replacement
  // for curl/scripts, just a point-and-click way to explore the contract
  // and send real requests (click "Authorize" top-right, paste your Urja
  // session token, then "Try it out" on any endpoint).
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  app.use('/api/meters', sessionAuth, metersRouter);
  app.use('/api/transformers', sessionAuth, transformersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
