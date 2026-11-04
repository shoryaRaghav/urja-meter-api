import express from 'express';
import { sessionAuth } from './middleware/sessionAuth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { metersRouter } from './routes/meters.js';
import { transformersRouter } from './routes/transformers.js';

export function createApp() {
  const app = express();

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/meters', sessionAuth, metersRouter);
  app.use('/api/transformers', sessionAuth, transformersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
