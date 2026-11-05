/**
 * Every normalization here exists because of a specific, verified quirk in
 * the upstream portal — see PROTOCOL.md for the evidence behind each one.
 * The goal: nothing that calls OUR api ever has to work around the
 * portal's raw inconsistencies.
 */

/** "" -> null. The bulk export has 22 hierarchy fields that are present-but-empty strings, never missing keys. */
export function emptyToNull(value) {
  return value === '' ? null : value;
}

/**
 * Upstream /geo returns {"latitude": "<string>", "longitude": "<string>"}.
 * The bulk export instead embeds {"lat": <number>, "lng": <number>}.
 * We standardize on one shape so callers never see either raw form.
 */
export function normalizeGeo(rawGeoData) {
  if (!rawGeoData) return null;
  const lat = Number(rawGeoData.latitude);
  const lng = Number(rawGeoData.longitude);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

/** Upstream timestamps are "DD/MM/YYYY HH:mm" (24h). Convert to ISO 8601. */
export function parseUpstreamTimestamp(raw) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min] = match;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
}

/**
 * Upstream /energy readings are numeric strings with inconsistent decimal
 * formatting ("48440" vs "48438.74") and are cumulative register values,
 * not per-interval usage.
 */
export function normalizeEnergyReading(raw) {
  return {
    timestamp: parseUpstreamTimestamp(raw.timestamp),
    kwh: Number(raw.kwh),
    kvah: Number(raw.kvah),
    voltR: Number(raw.voltR),
  };
}

/**
 * Register readings only go up over time. Most consumers of a "consumption"
 * API want usage per interval, not the raw cumulative register — so we
 * offer both rather than silently picking one. Assumes `readings` is
 * already in chronological order (confirmed true of upstream's /energy).
 */
export function withConsumptionDeltas(readings) {
  return readings.map((reading, i) => {
    if (i === 0) {
      return { ...reading, consumptionKwh: null, consumptionKvah: null };
    }
    const prev = readings[i - 1];
    return {
      ...reading,
      consumptionKwh: round(reading.kwh - prev.kwh),
      consumptionKvah: round(reading.kvah - prev.kvah),
    };
  });
}

function round(n, places = 2) {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

/**
 * The bulk export's embedded hierarchy.dt.name can be stale (confirmed:
 * DT-007 reads "Old Malviya Nagar Xfmr" on 3 trailing records vs. "Sanganer
 * DT 7" everywhere else, including /portal/dts itself). /portal/dts is the
 * canonical source for a DT's name — never trust the copy embedded on a
 * meter record.
 *
 * `hierarchy` is the raw {zone, circle, division, subdivision, substation,
 * feeder, dt} object (from the bulk export or an equivalent source);
 * `canonicalDtName` is looked up separately from /portal/dts by dtCode.
 */
export function normalizeHierarchy(hierarchy, canonicalDtName) {
  if (!hierarchy) return null;
  const levels = ['zone', 'circle', 'division', 'subdivision', 'substation', 'feeder', 'dt'];
  const normalized = {};
  for (const level of levels) {
    const entry = hierarchy[level] ?? {};
    normalized[level] = {
      name: emptyToNull(entry.name),
      code: emptyToNull(entry.code),
    };
  }
  if (canonicalDtName !== undefined) {
    normalized.dt.name = canonicalDtName;
  }
  return normalized;
}

/**
 * Shared by GET /api/meters/:meterId and GET /api/meters/export (bulk
 * extraction) so both endpoints merge live + snapshot data with the exact
 * same precedence instead of two copies quietly drifting apart.
 *
 * Precedence: live search result is authoritative for the fields it
 * returns (meterId, serialNo, make, phaseType, installStatus, dtCode);
 * the snapshot supplies installType, build, and hierarchy, none of which
 * live search ever returns (see PROTOCOL.md). geo/geoSource are passed in
 * rather than computed here, since the single-meter endpoint sources geo
 * live (one extra call is fine for one meter) while the bulk endpoint
 * sources it from the snapshot (403 live /geo calls is not fine) — see
 * architecture-decisions.md "4b" and the bulk-export route's doc comment.
 */
export function mergeMeterRecord({ meterId, liveMatch, snapshot, canonicalDtName, geo, geoSource }) {
  const dtCode = emptyToNull(liveMatch?.dtCode ?? snapshot?.dtCode);
  return {
    meterId,
    serialNo: liveMatch?.serialNo ?? snapshot?.serialNo ?? null,
    make: liveMatch?.make ?? snapshot?.make ?? null,
    phaseType: liveMatch?.phaseType ?? snapshot?.phaseType ?? null,
    installStatus: liveMatch?.installStatus ?? snapshot?.installStatus ?? null,
    installType: snapshot?.installType ?? null,
    build: snapshot?.build ?? null,
    dtCode,
    geo: geo ?? null,
    hierarchy: normalizeHierarchy(snapshot?.hierarchy, canonicalDtName),
    sources: {
      nameplateCore: liveMatch ? 'live' : 'snapshot',
      installType: snapshot ? 'snapshot' : null,
      build: snapshot ? 'snapshot' : null,
      hierarchy: snapshot ? 'snapshot (DT name always live)' : null,
      geo: geoSource ?? null,
    },
  };
}
