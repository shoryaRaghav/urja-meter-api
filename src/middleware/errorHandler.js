import { ApiError, UpstreamError } from '../utils/errors.js';

/**
 * Single place where every error in the app becomes a response. Express 5
 * forwards rejected promises from async route handlers here automatically
 * (no manual try/catch-and-next needed in routes).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { message: err.message } });
  }

  if (err instanceof UpstreamError) {
    // 502: we successfully made the request, but the upstream we depend on failed.
    // We deliberately don't pass through whatever shape the portal failed with.
    return res.status(502).json({
      error: {
        message: err.message,
        upstreamStatus: err.upstreamStatus,
      },
    });
  }

  console.error(err);
  return res.status(500).json({ error: { message: 'Internal server error' } });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route: ${req.method} ${req.originalUrl}` } });
}
