import { Router } from 'express';
import * as urjaClient from '../services/urjaClient.js';
import {
  normalizeGeo,
  normalizeEnergyReading,
  withConsumptionDeltas,
  emptyToNull,
  mergeMeterRecord,
} from '../utils/normalize.js';
import { getSnapshotRecord } from '../data/hierarchySnapshot.js';
import { recordsToCsv } from '../utils/csv.js';
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
 * GET /api/meters/export?format=json|csv
 *
 * "Authorised bulk data extraction" — exports nameplate + hierarchy + geo
 * for every meter in one response, mirroring the portal's own "Export all
 * meters" feature but through our normalized schema, with the exact same
 * live/snapshot provenance as GET /api/meters/:meterId below (same
 * mergeMeterRecord() call, same `sources` reporting per record).
 *
 * Still gated by the same session auth as every other endpoint —
 * "authorised" means a valid Urja session token is required, the same bar
 * as everything else. Nothing in the material this was built from called
 * for a separate bulk-specific credential; if the real requirement does,
 * that's an easy addition on top of this (see README "Known limitations").
 *
 * Deliberately metadata-only, no consumption: 403 meters x up to 337
 * readings each would be 100k+ rows per export and ~400 extra upstream
 * calls, with no demonstrated need. Fetch /consumption per meter instead.
 *
 * Efficiency: does ONE full paginated crawl of /portal/meters/search
 * (~21 requests for 403 meters at pageSize 20) and ONE of /portal/dts
 * (2 requests) per export call, rather than once per meter — the exact
 * scaling concern the per-meter endpoint's doc comment flags below is what
 * this endpoint avoids by batching. Geo and hierarchy/installType/build
 * come from the snapshot for every record here (not live), since a live
 * /geo call per meter would mean 403 more requests — see
 * architecture-decisions.md "4b" for why the snapshot is a confirmed,
 * permanent source for those fields, not a shortcut. No caching across
 * requests, consistent with the rest of v1.
 *
 * Registered BEFORE /:meterId below — otherwise Express would match
 * "export" as a meterId value and this route would never be reached.
 */
metersRouter.get('/export', async (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'json';

  const [liveMeters, liveDts] = await Promise.all([
    urjaClient.searchAllMeters(req.urjaSessionToken),
    urjaClient.listAllTransformers(req.urjaSessionToken),
  ]);

  const dtNameByCode = new Map(liveDts.map((d) => [d.code, d.name]));

  const records = liveMeters.map((liveMatch) => {
    const snapshot = getSnapshotRecord(liveMatch.meterId);
    const dtCode = emptyToNull(liveMatch.dtCode ?? snapshot?.dtCode);
    return mergeMeterRecord({
      meterId: liveMatch.meterId,
      liveMatch,
      snapshot,
      canonicalDtName: dtCode ? dtNameByCode.get(dtCode) : undefined,
      geo: snapshot?.geo ?? null,
      geoSource: snapshot ? 'snapshot' : null,
    });
  });

  if (format === 'csv') {
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="meters-export.csv"');
    return res.send(recordsToCsv(records));
  }

  res.json({
    generatedAt: new Date().toISOString(),
    total: records.length,
    data: records,
  });
});

/**
 * GET /api/meters/:meterId
 *
 * Merges two sources via the shared mergeMeterRecord() (see
 * utils/normalize.js), with explicit, reported precedence:
 *  - live /portal/meters/search: authoritative for meterId, serialNo, make,
 *    phaseType, installStatus, dtCode (confirmed raw — see PROTOCOL.md)
 *  - bulk-export snapshot (src/data/hierarchySnapshot.js): supplies
 *    installType, build, and hierarchy, none of which the live search
 *    endpoint returns at all — this is a confirmed, permanent design
 *    decision, not a placeholder (see architecture-decisions.md "4b")
 *  - geo: always live here, via /portal/meters/:id/geo (one extra call is
 *    fine for a single meter — contrast with GET /api/meters/export, which
 *    sources geo from the snapshot instead, since 403 live calls isn't)
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
    // off if this service needed to scale. GET /api/meters/export is the
    // batched alternative when fetching many meters at once.
    const dts = await urjaClient.listTransformers({ page: 1 }, req.urjaSessionToken);
    let dtEntry = (dts.data ?? []).find((d) => d.code === dtCode);
    if (!dtEntry && dts.total > (dts.pageSize ?? 20)) {
      const dts2 = await urjaClient.listTransformers({ page: 2 }, req.urjaSessionToken);
      dtEntry = (dts2.data ?? []).find((d) => d.code === dtCode);
    }
    canonicalDtName = dtEntry?.name;
  }

  res.json(
    mergeMeterRecord({
      meterId,
      liveMatch,
      snapshot,
      canonicalDtName,
      geo: normalizeGeo(geoResult.data),
      geoSource: 'live',
    })
  );
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
