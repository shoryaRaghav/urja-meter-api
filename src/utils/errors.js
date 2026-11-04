/**
 * Thrown when the upstream Urja Meter Ops portal returns a non-OK response,
 * or when a request to it fails outright (network error, timeout).
 *
 * Caught centrally by middleware/errorHandler.js and translated into a
 * consistent error envelope — callers of OUR api never see the portal's raw
 * failure shape (which we don't control and haven't fully characterized).
 */
export class UpstreamError extends Error {
  constructor(message, { upstreamStatus = null, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.upstreamStatus = upstreamStatus;
    if (cause) this.cause = cause;
  }
}

/** Thrown for client-facing 4xx conditions we raise ourselves (bad input, missing auth). */
export class ApiError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
