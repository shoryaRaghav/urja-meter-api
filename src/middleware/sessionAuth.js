import { ApiError } from '../utils/errors.js';

/**
 * This API never logs into Urja Meter Ops and never stores a portal
 * session. The caller must already hold a valid one (obtained by logging
 * into the portal themselves, exactly as a human user would) and pass it
 * on every request. See README "Authentication" for the reasoning.
 *
 * Accepts `Authorization: Bearer <token>` (primary) or `X-Urja-Session-Token`
 * (convenience alias). The raw token is attached to req.urjaSessionToken and
 * forwarded as-is to the upstream portal's session cookie — this service
 * never inspects, decodes, or persists it beyond the current request.
 */
export function sessionAuth(req, res, next) {
  const authHeader = req.get('authorization');
  const bearerMatch = authHeader && /^Bearer (.+)$/.exec(authHeader);
  const token = bearerMatch?.[1] || req.get('x-urja-session-token');

  if (!token) {
    return next(
      new ApiError(
        'Missing Urja Meter Ops session token. Provide it via "Authorization: Bearer <token>" ' +
          'or "X-Urja-Session-Token". This API does not manage portal logins — see README.',
        { status: 401 }
      )
    );
  }

  req.urjaSessionToken = token;
  next();
}
