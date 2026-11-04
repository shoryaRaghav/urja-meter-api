import { describe, it, expect } from 'vitest';
import { getSnapshotRecord, getSnapshotRecordsByDtCode } from '../../src/data/hierarchySnapshot.js';

describe('hierarchySnapshot (loaded from the real meter-export.json the user captured)', () => {
  it('finds a known meter by id', () => {
    const record = getSnapshotRecord('J100000');
    expect(record).toBeDefined();
    expect(record.serialNo).toBe('SE33962');
    expect(record.dtCode).toBe('DT-001');
  });

  it('returns undefined for a meter that does not exist', () => {
    expect(getSnapshotRecord('NOT-A-REAL-METER')).toBeUndefined();
  });

  it('reproduces the documented DT-007 data-quality finding: 13 meters, two different embedded DT names', () => {
    const records = getSnapshotRecordsByDtCode('DT-007');
    expect(records).toHaveLength(13);
    const names = new Set(records.map((m) => m.hierarchy.dt.name));
    expect(names).toEqual(new Set(['Sanganer DT 7', 'Old Malviya Nagar Xfmr']));
  });

  it('reproduces the exact total meter count from the bulk export', () => {
    // Sanity check the snapshot file itself hasn't been truncated/corrupted.
    const allDtCodes = new Set();
    for (let i = 1; i <= 40; i++) allDtCodes.add(`DT-${String(i).padStart(3, '0')}`);
    let total = 0;
    for (const code of allDtCodes) total += getSnapshotRecordsByDtCode(code).length;
    expect(total).toBe(403);
  });
});
