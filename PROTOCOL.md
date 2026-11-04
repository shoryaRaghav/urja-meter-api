# PROTOCOL.md — Urja Meter Ops, as discovered

Urja Meter Ops (`https://urja-ops.flockenergy.tech`) has no documented API. This
file records exactly what was verified about its behavior, how it was verified,
and what remains an assumption. Nothing here was guessed ahead of evidence —
every claim below traces back to either a raw HTTP response captured in
DevTools, or the portal's own bulk "Export all meters" download.

**Methodology note**: this investigation was done entirely from the browser
side by the developer, who holds their own authenticated session. No
automated tooling logged into the portal, scraped it, or replayed a
captured session; everything here comes from manually relayed DevTools
captures (cURL exports, Response-tab JSON, screenshots) and the portal's
own data export feature.

## Stack

- **Framework**: SvelteKit, confirmed by `__data.json?x-sveltekit-invalidated=...`
  loader requests on page navigation.
- **Auth**: cookie-based session, `__Secure-better-auth.session_token`,
  consistent with the open-source `better-auth` library. Sent as a cookie on
  every request, including calls to the internal JSON API below.
- **Internal JSON API**: the SPA calls a separate `/portal/*` path space for
  data, as plain JSON — not HTML it then renders client-side. This was the
  single most consequential finding of the investigation: it means a
  wrapper service needs no HTML scraping (no Cheerio, no DOM parsing), just
  authenticated calls to these JSON endpoints with the session cookie
  forwarded.

## Navigation / modules

- **Meters** — list/search, paginated, 403 total meters.
- **Transformers** — list of distribution transformers (DTs), paginated,
  40 total, with an "Export all meters" bulk-download button. Rows are
  **not clickable** — there is no DT detail page and no reverse DT→meters
  lookup anywhere on the portal.
- **Ops Desk** — static text content. Not a data module; no further
  investigation was needed.

## Confirmed endpoints

All raw-verified from the user's own DevTools Response tab (not inferred
from rendered HTML).

### `GET /portal/dts?page=<n>`
```json
{
  "data": [
    { "code": "DT-001", "name": "Malviya Nagar DT 1", "feederCode": "F-001", "capacityKva": 100 }
  ],
  "total": 40,
  "page": 1,
  "pageSize": 20
}
```
Pagination fields (`total`, `page`, `pageSize`) are **siblings of `data`** at
the top level. `capacityKva` is a real number — this is the only place
transformer capacity exists anywhere in the data; it is not in the bulk
export or anywhere else.

### `GET /portal/meters/search?q=<term>&page=<n>`
```json
{
  "data": [
    {
      "meterId": "J100000",
      "serialNo": "SE33962",
      "make": "HPL",
      "phaseType": "single",
      "installStatus": "Decommissioned",
      "dtCode": "DT-001"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```
Same envelope shape as `/portal/dts`. Search is **case-insensitive**
(`q=j100000` matched `J100000`). `q=""` returns the full list; the UI fires
this on every keystroke (debounced).

**This endpoint does not return `installType`, `build`, or any hierarchy
data** — only the six fields above. This was confirmed, not assumed, and
has a direct architectural consequence: see "No live single-meter hierarchy
endpoint" below.

### `GET /portal/meters/:id/geo`
```json
{ "data": { "latitude": "26.938961002479868", "longitude": "75.83095696146852" } }
```
Field names are `latitude`/`longitude`, and both are **numeric strings**,
not numbers. This does not match the bulk export's `geo: {lat, lng}` shape
(different names, different types) — see "Data quality issues" below.

### `GET /portal/meters/:id/energy`
```json
{
  "data": [
    { "timestamp": "23/06/2026 23:30", "kwh": "48438.74", "kvah": "52313.84", "voltR": "226" }
  ]
}
```
- 337 half-hourly readings observed for one meter (J100000), spanning a
  7-day window. Not paginated, and has no `total`/`page`/`pageSize` — unlike
  `/dts` and `/meters/search`, which are both paginated lists. The envelope
  convention (`{"data": ...}`) is consistent across endpoints; whether
  pagination metadata is present is not.
- `timestamp` format: `DD/MM/YYYY HH:mm`, 24-hour clock.
- `kwh`, `kvah`, `voltR` are strings with **inconsistent decimal
  formatting** — `"48438.74"` and `"48440"` (no decimal) both appear.
- **`kwh`/`kvah` are cumulative meter register readings, not per-interval
  usage.** The rendered consumption table shows the same cumulative values.
  Whether 7 days is always the window, or there's a date-range parameter,
  is not confirmed — only one capture was taken.

## Not used: the SvelteKit page loader

`GET /meters/:id/__data.json?x-sveltekit-invalidated=...` was also
captured. It returns SvelteKit's own `devalue`-serialized format — a flat
array of nodes referenced by index instead of plain nested JSON (e.g.
`{"parameterName": 5, "parameterValue": 1}` where `5` and `1` are indices
into the array). It carries the same nameplate and hierarchy fields already
available elsewhere in plain JSON. **Decision: not consumed.** Parsing
devalue correctly (recursive reference resolution, non-JSON-safe sentinel
values) would add real complexity for zero new data over the `/portal/*`
sources.

## The bulk "Export all meters" download

A button on `/transformers` downloads `meter-export.json` — **all 403
meters** with full nameplate, hierarchy, and geo in one file. This is
effectively the portal's own bulk data-extraction feature.

```json
{
  "meterId": "J100000",
  "serialNo": "SE33962",
  "make": "HPL",
  "phaseType": "single",
  "installStatus": "Decommissioned",
  "installType": "Whole Current",
  "build": "legacy",
  "dtCode": "DT-001",
  "hierarchy": {
    "zone": { "name": "Jaipur Zone 1", "code": "Z-01" },
    "circle": { "name": "Circle 1", "code": "C-01" },
    "division": { "name": "Division 1", "code": "D-01" },
    "subdivision": { "name": "Subdivision 1", "code": "SD-01" },
    "substation": { "name": "Substation 1", "code": "SS-01" },
    "feeder": { "name": "Feeder 1", "code": "F-001" },
    "dt": { "name": "Malviya Nagar DT 1", "code": "DT-001" }
  },
  "geo": { "lat": 26.938961002479868, "lng": 75.83095696146852 }
}
```

Verified counts (computed programmatically from all 403 records, not
eyeballed): 403 meters, 40 distinct DTs, 10–13 meters per DT.
`installStatus`: Installed 238 / Faulty 90 / Decommissioned 75.
`installType`: "Whole Current" 205 / "CT Operated" 198. `phaseType`: single
277 / three 126. `make`: HPL 90, L&T 64, Genus 88, Allied 76, Secure 85.
`build`: legacy 238 / v2 165 — **this field is not shown anywhere in the
rendered UI**; it's real backend data the portal simply doesn't surface
visually.

This export has no raw/live endpoint URL of its own that was captured — it
was obtained by clicking the button, not by inspecting the triggering
request. It is used in this project as a documented, static snapshot (see
"No live single-meter hierarchy endpoint" below), not as a live data
source.

## Data quality issues found

1. **22 empty-string hierarchy fields**, scattered across 15+ records
   (e.g. `circle.code: ""`, `feeder.name: ""`). Always present-but-empty
   strings, never missing keys.
2. **DT-007 has two different names** depending on which meter record you
   look at. Meters J100006–J100399 (the normal range) all agree DT-007 =
   "Sanganer DT 7" — matching `/portal/dts` exactly. Three records appended
   at the very end of the export (J100400–402) give DT-007's name as "Old
   Malviya Nagar Xfmr" instead. Those three records also stand out
   otherwise: all made by "Genus", serial numbers with a "GN" prefix unlike
   the rest of the data, meter IDs outside the normal sequential range.
   This looks like deliberately-seeded messy data rather than a capture
   error. **`/portal/dts` is the source of truth for a DT's name; the
   `hierarchy.dt.name` embedded on a meter record can be stale and should
   never be trusted on its own.**
3. `/portal/meters/:id/geo`'s field names and types (`latitude`/`longitude`
   as strings) don't match the bulk export's `geo: {lat, lng}` (numbers).
   An API built on both sources must normalize them into one shape rather
   than exposing either raw form.

## No live single-meter hierarchy endpoint (architectural consequence)

Every endpoint that returns per-meter data was raw-captured:
`/portal/meters/search` (nameplate only — no hierarchy, no `installType`,
no `build`), `/portal/meters/:id/geo`, `/portal/meters/:id/energy`. None of
them return a single meter's full network hierarchy. The only two places
that data exists are the bulk export and the SvelteKit page loader (not
used — see above). This means: **there is no live portal endpoint a
wrapper API can call to get one meter's hierarchy on demand.** This isn't
an investigation gap to close later — it's a confirmed fact about the
portal, with a direct design consequence documented in the implementation
(a per-meter hierarchy lookup necessarily falls back to a snapshot of the
bulk export).

## Open questions (not blocking, not investigated further)

- Whether the 7-day consumption window is fixed or variable, and whether a
  date-range query parameter exists — only one capture was taken.
- Rate limiting, error response shapes, and session-expiry behavior — no
  evidence either way.
