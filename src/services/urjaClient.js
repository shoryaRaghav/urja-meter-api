import { config } from '../config.js';
import { UpstreamError } from '../utils/errors.js';

const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';

/**
 * Thin wrapper around the upstream Urja Meter Ops portal's internal
 * `/portal/*` JSON API (confirmed in PROTOCOL.md — this is the same JSON
 * API the portal's own SvelteKit frontend calls; no HTML scraping involved).
 *
 * Deliberately NOT a class with stored state: every function takes the
 * caller's session token as an explicit argument. This service never holds
 * a session itself — see README "Authentication" for why. Each request to
 * our API can carry a different caller's token; nothing here may be cached
 * or reused across callers.
 */
async function upstreamGet(path, sessionToken) {
  const url = new URL(path, config.upstreamBaseUrl);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });
  } catch (cause) {
    throw new UpstreamError(`Failed to reach upstream portal at ${url}`, { cause });
  }

  if (!res.ok) {
    throw new UpstreamError(`Upstream portal returned ${res.status} for ${path}`, {
      upstreamStatus: res.status,
    });
  }

  try {
    return await res.json();
  } catch (cause) {
    throw new UpstreamError(`Upstream portal returned non-JSON for ${path}`, { cause });
  }
}

/**
 * GET /portal/meters/search?q=&page=
 * Confirmed fields (from the rendered meters list + bulk export, NOT a raw
 * capture of this specific endpoint — see PROTOCOL.md "documented
 * assumptions"): meterId, serialNo, make, phaseType, installStatus,
 * installType, dtCode. Envelope assumed `{data, total, page, pageSize}` by
 * analogy with /portal/dts, not yet confirmed raw for this endpoint.
 */
export function searchMeters({ q = '', page = 1 } = {}, sessionToken) {
  const qs = new URLSearchParams({ q, page: String(page) });
  return upstreamGet(`/portal/meters/search?${qs}`, sessionToken);
}

/**
 * GET /portal/meters/:id/geo
 * Confirmed raw shape: {"data": {"latitude": "<string>", "longitude": "<string>"}}
 */
export function getMeterGeo(meterId, sessionToken) {
  return upstreamGet(`/portal/meters/${encodeURIComponent(meterId)}/geo`, sessionToken);
}

/**
 * GET /portal/meters/:id/energy
 * Confirmed raw shape:
 * {"data": [{"timestamp": "DD/MM/YYYY HH:mm", "kwh": "<string>", "kvah": "<string>", "voltR": "<string>"}]}
 * Values are cumulative meter register readings, not per-interval deltas.
 */
export function getMeterEnergy(meterId, sessionToken) {
  return upstreamGet(`/portal/meters/${encodeURIComponent(meterId)}/energy`, sessionToken);
}

/**
 * GET /portal/dts?page=
 * Confirmed raw shape:
 * {"data": [{"code","name","feederCode","capacityKva"}], "total", "page", "pageSize"}
 */
export function listTransformers({ page = 1 } = {}, sessionToken) {
  const qs = new URLSearchParams({ page: String(page) });
  return upstreamGet(`/portal/dts?${qs}`, sessionToken);
}
