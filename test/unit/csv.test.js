import { describe, it, expect } from 'vitest';
import { recordsToCsv } from '../../src/utils/csv.js';

describe('recordsToCsv', () => {
  it('renders a header row and one row per record, flattening hierarchy and geo', () => {
    const records = [
      {
        meterId: 'J100000',
        serialNo: 'SE33962',
        make: 'HPL',
        phaseType: 'single',
        installStatus: 'Decommissioned',
        installType: 'Whole Current',
        build: 'legacy',
        dtCode: 'DT-001',
        geo: { lat: 26.9, lng: 75.8 },
        hierarchy: { zone: { name: 'Jaipur Zone 1', code: 'Z-01' }, dt: { name: 'Malviya Nagar DT 1', code: 'DT-001' } },
        sources: { nameplateCore: 'live', hierarchy: 'snapshot (DT name always live)', geo: 'snapshot' },
      },
    ];

    const csv = recordsToCsv(records);
    const lines = csv.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'meterId,serialNo,make,phaseType,installStatus,installType,build,dtCode,dtName,zoneName,zoneCode,circleName,circleCode,divisionName,divisionCode,subdivisionName,subdivisionCode,substationName,substationCode,feederName,feederCode,lat,lng,nameplateSource,hierarchySource,geoSource'
    );
    expect(lines[1]).toContain('J100000,SE33962,HPL,single,Decommissioned,Whole Current,legacy,DT-001,Malviya Nagar DT 1,Jaipur Zone 1,Z-01');
    expect(lines[1]).toContain('26.9,75.8');
  });

  it('escapes commas, quotes, and newlines, and renders missing values as empty', () => {
    const records = [
      { meterId: 'J1', serialNo: 'has,comma', make: 'has "quote"', hierarchy: null, geo: null, sources: {} },
    ];
    const csv = recordsToCsv(records);
    const dataLine = csv.trim().split('\n')[1];
    expect(dataLine).toContain('"has,comma"');
    expect(dataLine).toContain('"has ""quote"""');
  });
});
