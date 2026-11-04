import { Router } from 'express';
import * as urjaClient from '../services/urjaClient.js';
import {
  normalizeGeo,
  normalizeEnergyReading,
  normalizeHierarchy,
  withConsumptionDeltas,
  emptyToNull,
} from '../utils/normalize.js';
import { getSnapshotRecord } from '../data/hierarchySnapshot.js';
import { ApiError } from '../utils/errors.js';

export const metersRouter = Router();

/**
 * Fields /portal/meters/search actually returns (raw-confirmed — it does
 * NOT include installType, build, or hierarchy; see PROTOCOL.md).
 */
function normalizeMeterSummary(raw) {
  return {
    meterId: raw.meterId,
    serialNo: raw.serialNo,
    make: raw.make,
    phaseType: raw.phaseType,
    installStatus: raw.installStatus,
    dtCode: emptyToNull(raw.dtCode),
  };
}

/**
 * GET /api/meters?q=&page=
 * Proxies /portal/meters/search (raw-confirmed envelope and field names —
 * see PROTOCOL.md). Note this list view intentionally does NOT include
 * installType/build/hierarchy: the live search endpoint simply doesn't
 * return them for a list of meters. Those only become available on the
 * single-meter detail endpoint below, which merges in the bulk-export
 * snapshot.
 */
metersRouter.get('/', async (req, res) => {
  const { q = '', page = '1' } = req.query;
  const upstream = await urjaClient.searchMeters({ q, page: Number(page) || 1 }, req.urjaSessionToken);
  res.json({
    data: (upstream.data ?? []).map(normalizeMeterSummary),
    page: upstream.page ?? (Number(page) || 1),
    pageSize: upstream.pageSize ?? null,
    total: upstream.total ?? null,
  });
});

/**
 * GET /api/meters/:meterId
 *
 * Merges two sources with explicit, reported precedence:
 *  - live /portal/meters/search: authoritative for meterId, serialNo, make,
 *    phaseType, installStatus, dtCode (confirmed raw — see PROTOCOL.md)
 *  - bulk-export snapshot (src/data/hierarchySnapshot.js): supplies
 *    installType, build, and hierarchy, none of which the live search
 *    endpoint returns at all — this is a confirmed, permanent design
 *    decision, not a placeholder (see architecture-decisions.md "4b")
 *  - geo: always live, via /portal/meters/:id/geo
 *  - hierarchy.dt.name: always live, via /portal/dts, overriding whatever
 *    the snapshot's embedded copy says (DT-007 finding — that copy goes
 *    stale)
 *
 * The response's `sources` field states which source backed each part, so
 * API consumers are never left guessing how fresh a given field is.
 */
metersRouter.get('/:meterId', async (req, res) => {
  const { meterId } = req.params;

  const [searchResult, geoResult] = await Promise.all([
    urjaClient.searchMeters({ q: meterId, page: 1 }, req.urjaSessionToken),
    urjaClient.getMeterGeo(meterId, req.urjaSessionToken),
  ]);

  const liveMatch = (searchResult.data ?? []).find((m) => m.meterId === meterId);
  const snapshot = getSnapshotRecord(meterId);

  if (!liveMatch && !snapshot) {
    throw new ApiError(`Meter ${meterId} not found`, { status: 404 });
  }

  const dtCode = emptyToNull(liveMatch?.dtCode ?? snapshot?.dtCode);

  let canonicalDtName;
  if (dtCode) {
    // Small, deliberate inefficiency for v1: one extra upstream call per
    // meter-detail request to stay correct (always-fresh DT name) rather
    // than fast. See README "Known limitations" re: caching being out of
    // scope for v1 — this is the first place caching /portal/dts would pay
    // off if this service needed to scale.
    const dts = await urjaClient.listTransformers({ page: 1 }, req.urjaSessionToken);
    let dtEntry = (dts.data ?? []).find((d) => d.code === dtCode);
    if (!dtEntry && dts.total > (dts.pageSize ?? 20)) {
      const dts2 = await urjaClient.listTransformers({ page: 2 }, req.urjaSessionToken);
      dtEntry = (dts2.data ?? []).find((d) => d.code === dtCode);
    }
    canonicalDtName = dtEntry?.name;
  }

  res.json({
    meterId,
    serialNo: liveMatch?.serialNo ?? snapshot?.serialNo ?? null,
    make: liveMatch?.make ?? snapshot?.make ?? null,
    phaseType: liveMatch?.phaseType ?? snapshot?.phaseType ?? null,
    installStatus: liveMatch?.installStatus ?? snapshot?.installStatus ?? null,
    installType: snapshot?.installType ?? null,
    build: snapshot?.build ?? null,
    dtCode,
    geo: normalizeGeo(geoResult.data),
    hierarchy: normalizeHierarchy(snapshot?.hierarchy, canonicalDtName),
    sources: {
      nameplateCore: liveMatch ? 'live' : 'snapshot',
      installType: snapshot ? 'snapshot' : null,
      build: snapshot ? 'snapshot' : null,
      hierarchy: snapshot ? 'snapshot (DT name always live)' : null,
      geo: 'live',
    },
  });
});

/**
 * GET /api/meters/:meterId/consumption?delta=true
 * Proxies /portal/meters/:id/energy. Raw cumulative register values are
 * always returned; pass ?delta=true to also include the per-interval
 * usage delta (consumptionKwh/consumptionKvah) — see PROTOCOL.md for why
 * both are offered rather than picking one silently.
 */
metersRouter.get('/:meterId/consumption', async (req, res) => {
  const { meterId } = req.params;
  const includeDelta = req.query.delta === 'true';

  const upstream = await urjaClient.getMeterEnergy(meterId, req.urjaSessionToken);
  let readings = (upstream.data ?? []).map(normalizeEnergyReading);
  if (includeDelta) readings = withConsumptionDeltas(readings);

  res.json({ meterId, readings });
});
