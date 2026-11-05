/**
 * CSV rendering for the bulk meter export (GET /api/meters/export?format=csv).
 * Only used there — a small, purpose-built flattener, not a general CSV library.
 */
function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const COLUMNS = [
  ['meterId', (r) => r.meterId],
  ['serialNo', (r) => r.serialNo],
  ['make', (r) => r.make],
  ['phaseType', (r) => r.phaseType],
  ['installStatus', (r) => r.installStatus],
  ['installType', (r) => r.installType],
  ['build', (r) => r.build],
  ['dtCode', (r) => r.dtCode],
  ['dtName', (r) => r.hierarchy?.dt?.name],
  ['zoneName', (r) => r.hierarchy?.zone?.name],
  ['zoneCode', (r) => r.hierarchy?.zone?.code],
  ['circleName', (r) => r.hierarchy?.circle?.name],
  ['circleCode', (r) => r.hierarchy?.circle?.code],
  ['divisionName', (r) => r.hierarchy?.division?.name],
  ['divisionCode', (r) => r.hierarchy?.division?.code],
  ['subdivisionName', (r) => r.hierarchy?.subdivision?.name],
  ['subdivisionCode', (r) => r.hierarchy?.subdivision?.code],
  ['substationName', (r) => r.hierarchy?.substation?.name],
  ['substationCode', (r) => r.hierarchy?.substation?.code],
  ['feederName', (r) => r.hierarchy?.feeder?.name],
  ['feederCode', (r) => r.hierarchy?.feeder?.code],
  ['lat', (r) => r.geo?.lat],
  ['lng', (r) => r.geo?.lng],
  ['nameplateSource', (r) => r.sources?.nameplateCore],
  ['hierarchySource', (r) => r.sources?.hierarchy],
  ['geoSource', (r) => r.sources?.geo],
];

export function recordsToCsv(records) {
  const header = COLUMNS.map(([name]) => name).join(',');
  const lines = records.map((r) => COLUMNS.map(([, get]) => escapeCsvValue(get(r))).join(','));
  return [header, ...lines].join('\n') + '\n';
}
