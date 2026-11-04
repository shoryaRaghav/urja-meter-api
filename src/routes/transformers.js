import { Router } from 'express';
import * as urjaClient from '../services/urjaClient.js';
import { getSnapshotRecordsByDtCode } from '../data/hierarchySnapshot.js';
import { normalizeHierarchy } from '../utils/normalize.js';

export const transformersRouter = Router();

function normalizeTransformer(raw) {
  return {
    code: raw.code,
    name: raw.name,
    feederCode: raw.feederCode,
    capacityKva: raw.capacityKva,
  };
}

/** GET /api/transformers?page= — proxies /portal/dts (confirmed raw). */
transformersRouter.get('/', async (req, res) => {
  const page = Number(req.query.page) || 1;
  const upstream = await urjaClient.listTransformers({ page }, req.urjaSessionToken);
  res.json({
    data: (upstream.data ?? []).map(normalizeTransformer),
    page: upstream.page ?? page,
    pageSize: upstream.pageSize ?? null,
    total: upstream.total ?? null,
  });
});

/**
 * GET /api/transformers/:code/meters
 * Not available on the portal itself — transformer rows aren't clickable
 * and there's no reverse DT -> meters lookup (confirmed in PROTOCOL.md).
 * Synthesized here from the provisional bulk-export snapshot (see
 * src/data/hierarchySnapshot.js) by filtering on dtCode.
 */
transformersRouter.get('/:code/meters', (req, res) => {
  const { code } = req.params;
  const records = getSnapshotRecordsByDtCode(code);
  res.json({
    dtCode: code,
    source: 'snapshot',
    data: records.map((r) => ({
      meterId: r.meterId,
      serialNo: r.serialNo,
      make: r.make,
      phaseType: r.phaseType,
      installStatus: r.installStatus,
      hierarchy: normalizeHierarchy(r.hierarchy),
    })),
  });
});
