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
 * Confirmed raw shape (see PROTOCOL.md): {"data": [{meterId, serialNo,
 * make, phaseType, installStatus, dtCode}], "total", "page", "pageSize"}.
 * Does NOT return installType, build, or hierarchy — confirmed absent, not
 * assumed.
 */
export function searchMeters({ q = '', page = 1 } = {}, sessionToken) {
  const qs = new URLSearchParams({ q, page: String(page) });
  return upstreamGet(`/portal/meters/search?${qs}`, sessionToken);
}

const PAGE_CRAWL_CONCURRENCY = 5;
const PAGE_CRAWL_MAX_PAGES = 1000; // defensive stop against a malformed/huge response, not an expected real limit

/**
 * Walks every page of a paginated upstream list endpoint and returns the
 * full flat list, in page order. Fetches page 1 first (its response tells
 * us the real `total`/`pageSize`, so we know exactly how many pages exist
 * without probing one at a time), then fetches the rest concurrently —
 * bounded to PAGE_CRAWL_CONCURRENCY at once rather than firing all ~20
 * pages simultaneously. That bound is a deliberate middle ground: still far
 * fewer round-trips than a page-by-page serial crawl, without bursting a
 * legacy system with every request at once.
 *
 * `fetchPage(page)` must return the upstream's raw `{data, total, pageSize}`
 * envelope for that page.
 */
async function crawlAllPages(fetchPage) {
  const first = await fetchPage(1);
  const firstBatch = first.data ?? [];
  if (firstBatch.length === 0) return [];

  const total = first.total ?? firstBatch.length;
  const pageSize = first.pageSize > 0 ? first.pageSize : firstBatch.length;
  const totalPages = Math.min(Math.max(Math.ceil(total / pageSize), 1), PAGE_CRAWL_MAX_PAGES);

  if (totalPages <= 1) return firstBatch;

  const remainingPageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const remainingBatches = new Array(remainingPageNumbers.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < remainingPageNumbers.length) {
      const i = nextIndex;
      nextIndex += 1;
      const res = await fetchPage(remainingPageNumbers[i]);
      remainingBatches[i] = res.data ?? [];
    }
  }

  const workerCount = Math.min(PAGE_CRAWL_CONCURRENCY, remainingPageNumbers.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return [...firstBatch, ...remainingBatches.flat()];
}

/**
 * Full flat list of every meter from /portal/meters/search (q=""). Used by
 * the bulk-export endpoint to get a fresh nameplate list for all meters
 * with ~21 requests total, instead of one search call per meter.
 */
export async function searchAllMeters(sessionToken) {
  return crawlAllPages((page) => searchMeters({ q: '', page }, sessionToken));
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

/**
 * Full flat list of every transformer from /portal/dts. Used by the
 * bulk-export endpoint to build one dtCode -> canonical name map per export
 * call, instead of calling /portal/dts separately for every meter (see the
 * per-meter doc comment in routes/meters.js for why that's the scaling
 * concern this function exists to avoid). Same bounded-concurrency crawl as
 * searchAllMeters.
 */
export async function listAllTransformers(sessionToken) {
  return crawlAllPages((page) => listTransformers({ page }, sessionToken));
}
