import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { searchAllMeters, listAllTransformers } from '../../src/services/urjaClient.js';
import { mockUpstream, restoreUpstream, jsonReply } from '../helpers/mockUpstream.js';

let upstream;

beforeEach(() => {
  upstream = mockUpstream();
});

afterEach(async () => {
  await restoreUpstream();
});

describe('searchAllMeters', () => {
  it('walks every page until it has collected `total` records', async () => {
    const page = (n, data) => ({ data, total: 45, page: n, pageSize: 20 });
    upstream.intercept({ path: '/portal/meters/search?q=&page=1', method: 'GET' }).reply(200, jsonReply(page(1, Array.from({ length: 20 }, (_, i) => ({ meterId: `M${i}` })))).data);
    upstream.intercept({ path: '/portal/meters/search?q=&page=2', method: 'GET' }).reply(200, jsonReply(page(2, Array.from({ length: 20 }, (_, i) => ({ meterId: `M${20 + i}` })))).data);
    upstream.intercept({ path: '/portal/meters/search?q=&page=3', method: 'GET' }).reply(200, jsonReply(page(3, Array.from({ length: 5 }, (_, i) => ({ meterId: `M${40 + i}` })))).data);

    const all = await searchAllMeters('token');
    expect(all).toHaveLength(45);
    expect(all[0].meterId).toBe('M0');
    expect(all[44].meterId).toBe('M44');
  });

  it('stops without error on a single page when total fits in one page', async () => {
    upstream.intercept({ path: '/portal/meters/search?q=&page=1', method: 'GET' }).reply(200, jsonReply({ data: [{ meterId: 'J1' }], total: 1, page: 1, pageSize: 20 }).data);

    const all = await searchAllMeters('token');
    expect(all).toEqual([{ meterId: 'J1' }]);
  });

  it('preserves page order across more pages than the concurrency limit (bounded concurrent crawl)', async () => {
    // 12 pages of 10 — more than the 5-at-a-time concurrency bound, so this
    // only passes if results are reassembled in page order regardless of
    // which concurrent request happens to resolve first.
    const totalPages = 12;
    const pageSize = 10;
    const total = totalPages * pageSize;
    for (let p = 1; p <= totalPages; p += 1) {
      const batch = Array.from({ length: pageSize }, (_, i) => ({ meterId: `M${(p - 1) * pageSize + i}` }));
      upstream.intercept({ path: `/portal/meters/search?q=&page=${p}`, method: 'GET' }).reply(200, jsonReply({ data: batch, total, page: p, pageSize }).data);
    }

    const all = await searchAllMeters('token');
    expect(all).toHaveLength(total);
    expect(all.map((m) => m.meterId)).toEqual(Array.from({ length: total }, (_, i) => `M${i}`));
  });
});

describe('listAllTransformers', () => {
  it('walks every page of /portal/dts', async () => {
    upstream.intercept({ path: '/portal/dts?page=1', method: 'GET' }).reply(200, jsonReply({ data: Array.from({ length: 20 }, (_, i) => ({ code: `DT-${i}`, name: `n${i}` })), total: 40, page: 1, pageSize: 20 }).data);
    upstream.intercept({ path: '/portal/dts?page=2', method: 'GET' }).reply(200, jsonReply({ data: Array.from({ length: 20 }, (_, i) => ({ code: `DT-${20 + i}`, name: `n${20 + i}` })), total: 40, page: 2, pageSize: 20 }).data);

    const all = await listAllTransformers('token');
    expect(all).toHaveLength(40);
    expect(all[39].code).toBe('DT-39');
  });
});
