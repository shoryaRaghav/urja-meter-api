import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mockUpstream, restoreUpstream, jsonReply } from '../helpers/mockUpstream.js';
import { fixture } from '../helpers/fixture.js';

const app = createApp();
const AUTH = { Authorization: 'Bearer test-session-token' };

let upstream;

beforeEach(() => {
  upstream = mockUpstream();
});

afterEach(async () => {
  await restoreUpstream();
});

describe('auth gating', () => {
  it('401s without a session token — this API never logs in on the caller\'s behalf', async () => {
    const res = await request(app).get('/api/meters');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/session token/i);
  });

  it('accepts X-Urja-Session-Token as an alias for Authorization: Bearer', async () => {
    upstream.intercept({ path: '/portal/meters/search?q=&page=1', method: 'GET' }).reply(200, jsonReply(fixture('meterSearchJ100000.json')).data);
    const res = await request(app).get('/api/meters').set('X-Urja-Session-Token', 'test-session-token');
    expect(res.status).toBe(200);
  });
});

describe('404 handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe('GET /health', () => {
  it('does not require auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/transformers', () => {
  it('proxies and normalizes /portal/dts (real captured page-1 fixture)', async () => {
    upstream.intercept({ path: '/portal/dts?page=1', method: 'GET' }).reply(200, jsonReply(fixture('dtsPage1.json')).data);

    const res = await request(app).get('/api/transformers').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(40);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.data[6]).toEqual({ code: 'DT-007', name: 'Sanganer DT 7', feederCode: 'F-007', capacityKva: 63 });
  });
});

describe('GET /api/transformers/:code/meters', () => {
  it('reverse-looks-up meters under DT-007 from the snapshot — no portal call, no reverse lookup exists upstream', async () => {
    const res = await request(app).get('/api/transformers/DT-007/meters').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('snapshot');
    expect(res.body.data).toHaveLength(13);
    // The canonical name from /portal/dts (not called here) isn't resolved on this
    // route, so callers still see the raw embedded names split across both variants.
    const names = new Set(res.body.data.map((m) => m.hierarchy.dt.name));
    expect(names.has('Sanganer DT 7')).toBe(true);
  });
});

describe('GET /api/meters', () => {
  it('proxies and normalizes /portal/meters/search, with no installType/build/hierarchy (confirmed absent live)', async () => {
    upstream.intercept({ path: '/portal/meters/search?q=J100000&page=1', method: 'GET' }).reply(200, jsonReply(fixture('meterSearchJ100000.json')).data);

    const res = await request(app).get('/api/meters?q=J100000').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual({
      meterId: 'J100000',
      serialNo: 'SE33962',
      make: 'HPL',
      phaseType: 'single',
      installStatus: 'Decommissioned',
      dtCode: 'DT-001',
    });
    expect(res.body.data[0].installType).toBeUndefined();
  });
});

describe('GET /api/meters/:meterId', () => {
  it('merges live search + geo with the snapshot\'s installType/build/hierarchy, and reports sources', async () => {
    upstream.intercept({ path: '/portal/meters/search?q=J100000&page=1', method: 'GET' }).reply(200, jsonReply(fixture('meterSearchJ100000.json')).data);
    upstream.intercept({ path: '/portal/meters/J100000/geo', method: 'GET' }).reply(200, jsonReply(fixture('geoJ100000.json')).data);
    upstream.intercept({ path: '/portal/dts?page=1', method: 'GET' }).reply(200, jsonReply(fixture('dtsPage1.json')).data);

    const res = await request(app).get('/api/meters/J100000').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.meterId).toBe('J100000');
    expect(res.body.serialNo).toBe('SE33962'); // from live search
    expect(res.body.installType).toBe('Whole Current'); // only the snapshot has this
    expect(res.body.build).toBe('legacy'); // only the snapshot has this
    expect(res.body.geo).toEqual({ lat: 26.938961002479868, lng: 75.83095696146852 });
    expect(res.body.hierarchy.zone.name).toBe('Jaipur Zone 1');
    expect(res.body.sources).toEqual({
      nameplateCore: 'live',
      installType: 'snapshot',
      build: 'snapshot',
      hierarchy: 'snapshot (DT name always live)',
      geo: 'live',
    });
  });

  it('fixes the DT-007 stale-name quirk end to end for an affected meter', async () => {
    // J100400 is one of the 3 anomalous trailing export records whose embedded
    // hierarchy.dt.name disagrees with the canonical /portal/dts listing.
    upstream.intercept({ path: '/portal/meters/search?q=J100400&page=1', method: 'GET' }).reply(200, jsonReply({ data: [], total: 0, page: 1, pageSize: 20 }).data);
    upstream.intercept({ path: '/portal/meters/J100400/geo', method: 'GET' }).reply(200, jsonReply({ data: { latitude: '26.9', longitude: '75.8' } }).data);
    upstream.intercept({ path: '/portal/dts?page=1', method: 'GET' }).reply(200, jsonReply(fixture('dtsPage1.json')).data);

    const res = await request(app).get('/api/meters/J100400').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.hierarchy.dt.code).toBe('DT-007');
    expect(res.body.hierarchy.dt.name).toBe('Sanganer DT 7'); // canonical, NOT "Old Malviya Nagar Xfmr"
    expect(res.body.sources.nameplateCore).toBe('snapshot'); // no live match this time
  });

  it('404s when a meter exists in neither live search nor the snapshot', async () => {
    upstream.intercept({ path: '/portal/meters/search?q=NOPE&page=1', method: 'GET' }).reply(200, jsonReply({ data: [], total: 0, page: 1, pageSize: 20 }).data);
    upstream.intercept({ path: '/portal/meters/NOPE/geo', method: 'GET' }).reply(200, jsonReply({ data: { latitude: '0', longitude: '0' } }).data);

    const res = await request(app).get('/api/meters/NOPE').set(AUTH);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/meters/:meterId/consumption', () => {
  it('normalizes raw cumulative readings without delta by default', async () => {
    upstream.intercept({ path: '/portal/meters/J100000/energy', method: 'GET' }).reply(200, jsonReply(fixture('energyJ100000Sample.json')).data);

    const res = await request(app).get('/api/meters/J100000/consumption').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.readings).toHaveLength(5);
    expect(res.body.readings[0]).toEqual({ timestamp: '2026-06-23T23:30:00', kwh: 48438.74, kvah: 52313.84, voltR: 226 });
    expect(res.body.readings[0].consumptionKwh).toBeUndefined();
  });

  it('includes per-interval deltas with ?delta=true', async () => {
    upstream.intercept({ path: '/portal/meters/J100000/energy', method: 'GET' }).reply(200, jsonReply(fixture('energyJ100000Sample.json')).data);

    const res = await request(app).get('/api/meters/J100000/consumption?delta=true').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.readings[0].consumptionKwh).toBeNull();
    expect(res.body.readings[1].consumptionKwh).toBeCloseTo(0.42, 5);
  });
});

describe('upstream failure handling', () => {
  it('translates an upstream 500 into a 502 with a clean error envelope', async () => {
    upstream.intercept({ path: '/portal/dts?page=1', method: 'GET' }).reply(500, 'upstream exploded');

    const res = await request(app).get('/api/transformers').set(AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error.upstreamStatus).toBe(500);
  });
});
