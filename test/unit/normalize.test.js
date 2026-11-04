import { describe, it, expect } from 'vitest';
import {
  emptyToNull,
  normalizeGeo,
  parseUpstreamTimestamp,
  normalizeEnergyReading,
  withConsumptionDeltas,
  normalizeHierarchy,
} from '../../src/utils/normalize.js';

describe('emptyToNull', () => {
  it('turns empty string into null (bulk export quirk: 22 fields are "" not missing)', () => {
    expect(emptyToNull('')).toBeNull();
    expect(emptyToNull('F-001')).toBe('F-001');
    expect(emptyToNull(undefined)).toBeUndefined();
  });
});

describe('normalizeGeo', () => {
  it('converts the live /geo endpoint\'s numeric strings into numbers', () => {
    // Exact payload captured from GET /portal/meters/J100000/geo
    const raw = { latitude: '26.938961002479868', longitude: '75.83095696146852' };
    expect(normalizeGeo(raw)).toEqual({ lat: 26.938961002479868, lng: 75.83095696146852 });
  });

  it('returns null for missing input rather than throwing', () => {
    expect(normalizeGeo(null)).toBeNull();
    expect(normalizeGeo(undefined)).toBeNull();
  });
});

describe('parseUpstreamTimestamp', () => {
  it('parses the portal\'s DD/MM/YYYY HH:mm format to ISO 8601', () => {
    expect(parseUpstreamTimestamp('24/06/2026 01:00')).toBe('2026-06-24T01:00:00');
    expect(parseUpstreamTimestamp('23/06/2026 23:30')).toBe('2026-06-23T23:30:00');
  });

  it('returns null for unparseable input instead of throwing', () => {
    expect(parseUpstreamTimestamp('not a date')).toBeNull();
  });
});

describe('normalizeEnergyReading', () => {
  it('converts numeric strings to numbers, including whole-number values with no decimal (upstream quirk)', () => {
    // "48440" (no decimal) vs "48438.74" (2dp) both appear in real captures
    expect(normalizeEnergyReading({ timestamp: '24/06/2026 01:00', kwh: '48440', kvah: '52315.2', voltR: '230' })).toEqual({
      timestamp: '2026-06-24T01:00:00',
      kwh: 48440,
      kvah: 52315.2,
      voltR: 230,
    });
  });
});

describe('withConsumptionDeltas', () => {
  it('computes per-interval usage from cumulative register readings (real captured values)', () => {
    const readings = [
      { timestamp: '24/06/2026 00:00', kwh: 48439.16, kvah: 52314.29, voltR: 229 },
      { timestamp: '24/06/2026 00:30', kwh: 48439.58, kvah: 52314.75, voltR: 220 },
    ];
    const result = withConsumptionDeltas(readings);
    expect(result[0].consumptionKwh).toBeNull(); // no prior reading to diff against
    expect(result[1].consumptionKwh).toBeCloseTo(0.42, 5);
    expect(result[1].consumptionKvah).toBeCloseTo(0.46, 5);
  });

  it('never returns a negative delta from monotonically increasing real data', () => {
    // Register values only go up; a negative delta here would mean our math is wrong.
    const readings = [
      { timestamp: 't1', kwh: 100, kvah: 100, voltR: 230 },
      { timestamp: 't2', kwh: 100.5, kvah: 100.2, voltR: 230 },
      { timestamp: 't3', kwh: 101, kvah: 100.9, voltR: 230 },
    ];
    const result = withConsumptionDeltas(readings);
    for (const r of result.slice(1)) {
      expect(r.consumptionKwh).toBeGreaterThanOrEqual(0);
      expect(r.consumptionKvah).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('normalizeHierarchy', () => {
  it('fixes the DT-007 stale-name quirk: canonical name from /portal/dts always wins over the embedded copy', () => {
    // Exact shape of the 3 trailing anomalous export records (J100400-402)
    const raw = {
      zone: { name: 'Jaipur Zone 1', code: 'Z-01' },
      circle: { name: 'Circle 1', code: 'C-01' },
      division: { name: 'Division 1', code: 'D-01' },
      subdivision: { name: 'Subdivision 1', code: 'SD-01' },
      substation: { name: 'Substation 1', code: 'SS-01' },
      feeder: { name: 'Feeder 7', code: 'F-007' },
      dt: { name: 'Old Malviya Nagar Xfmr', code: 'DT-007' }, // stale embedded name
    };
    const result = normalizeHierarchy(raw, 'Sanganer DT 7'); // canonical name from /portal/dts
    expect(result.dt.name).toBe('Sanganer DT 7');
    expect(result.dt.code).toBe('DT-007');
  });

  it('converts empty-string hierarchy fields to null', () => {
    const raw = {
      zone: { name: 'Zone', code: 'Z-01' },
      circle: { name: '', code: 'C-01' },
      division: { name: 'D', code: '' },
      subdivision: { name: '', code: '' },
      substation: { name: 'S', code: 'SS-01' },
      feeder: { name: 'F', code: 'F-001' },
      dt: { name: 'DT', code: 'DT-001' },
    };
    const result = normalizeHierarchy(raw);
    expect(result.circle.name).toBeNull();
    expect(result.division.code).toBeNull();
    expect(result.subdivision).toEqual({ name: null, code: null });
  });

  it('returns null for missing hierarchy rather than throwing', () => {
    expect(normalizeHierarchy(null)).toBeNull();
  });
});
