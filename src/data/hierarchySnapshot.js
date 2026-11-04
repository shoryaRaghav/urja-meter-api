import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Confirmed necessary, not a placeholder — see PROTOCOL.md and
 * architecture-decisions.md "4b".
 *
 * Why this exists: /portal/meters/search was raw-captured and returns only
 * {meterId, serialNo, make, phaseType, installStatus, dtCode} — no
 * installType, no build, no hierarchy. /portal/dts and /portal/meters/:id/
 * {geo,energy} don't carry it either. The only two places a single meter's
 * full 7-level network hierarchy exists are the portal's bulk "Export all
 * meters" download and the SvelteKit page-loader (__data.json), which we
 * deliberately don't consume (see PROTOCOL.md: devalue-encoded, no new
 * data over the plain-JSON sources). So GET /api/meters/:meterId resolves
 * hierarchy, installType, and build from this snapshot — a real export the
 * user performed from their own authenticated session, committed here
 * verbatim — by design, not as a TODO.
 *
 * This is a known, explicit trade-off: hierarchy/installType/build can go
 * stale if the portal's topology changes after this snapshot was taken.
 * DT *names* are the one exception — still resolved live via /portal/dts
 * on every request, never from this snapshot, because the embedded copy is
 * known to go stale (DT-007 finding) while /portal/dts is cheap to call
 * and always fresh.
 */
const SNAPSHOT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'meter-export-snapshot.json');

let byMeterId = null;

function load() {
  if (byMeterId) return byMeterId;
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
  byMeterId = new Map(raw.map((m) => [m.meterId, m]));
  return byMeterId;
}

/** Returns the raw snapshot record for a meterId, or undefined if not found. */
export function getSnapshotRecord(meterId) {
  return load().get(meterId);
}

/** Returns all raw snapshot records whose dtCode matches (used for the transformer -> meters reverse lookup). */
export function getSnapshotRecordsByDtCode(dtCode) {
  return [...load().values()].filter((m) => m.dtCode === dtCode);
}
