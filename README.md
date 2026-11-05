# Urja Meter API

A clean, documented REST API in front of the legacy **Urja Meter Ops**
portal (`https://urja-ops.flockenergy.tech`), which has no API of its own.
Exposes meter details, network hierarchy, and consumption data as
well-structured JSON.

- **[PROTOCOL.md](./PROTOCOL.md)** — how the upstream portal actually
  behaves, as discovered, with evidence.
- **[openapi.json](./openapi.json)** — full contract for this API.
- **[REFLECTION.md](./REFLECTION.md)** — the assignment's reflection
  questions.

## Why it's built this way

The portal's own frontend (SvelteKit) calls an internal `/portal/*` JSON
API for all its data — confirmed by inspecting the network traffic, not
assumed. That means this project is a thin **adapter/BFF layer**, not a
scraper: no HTML parsing, just authenticated JSON calls to endpoints the
portal itself already uses, reshaped into one clean, consistent, documented
surface.

Every normalization rule in the code exists because of a specific,
verified quirk in the upstream data — not a guess. See [PROTOCOL.md](./PROTOCOL.md)
for the evidence behind each one (geo field names/types that don't match
the bulk export, empty-string hierarchy fields, a distribution transformer
with two different names depending on which record you ask, inconsistent
decimal formatting on consumption readings).

## Endpoints

| Method & path | What it does |
|---|---|
| `GET /health` | Liveness check, no auth |
| `GET /api/meters?q=&page=` | Search/list meters (live) |
| `GET /api/meters/export?format=json\|csv` | **Authorised bulk data extraction** — every meter's nameplate + hierarchy + geo in one response |
| `GET /api/meters/:meterId` | One meter's full detail, live + snapshot merged |
| `GET /api/meters/:meterId/consumption?delta=true` | Consumption readings, raw or with per-interval deltas |
| `GET /api/transformers?page=` | List distribution transformers (live) |
| `GET /api/transformers/:code/meters` | Meters under a transformer (not available upstream — synthesized from the snapshot) |

Full request/response detail for each is in [openapi.json](./openapi.json), browsable at `/docs` once the server is running (see below).

### Bulk data extraction

`GET /api/meters/export` mirrors the portal's own "Export all meters"
feature, through this API's normalized schema instead of the portal's raw
one. It's still gated by the same `Authorization` header as everything else
— "authorised" here means a valid Urja session, same bar as every other
endpoint, not a separate mechanism. Metadata only (no consumption — see
"Known limitations"). It does one full paginated crawl of the upstream
meter search and transformer list per call (not a lookup per meter), so
it's efficient, but it still has to wait on ~23 upstream requests; it's not
instant.

```bash
curl http://localhost:3000/api/meters/export \
  -H "Authorization: Bearer <your-urja-session-token>" | head -c 500

curl "http://localhost:3000/api/meters/export?format=csv" \
  -H "Authorization: Bearer <your-urja-session-token>" -o meters-export.csv
```

## Authentication

**This API never logs into Urja Meter Ops and never stores a session.**

The caller must already hold a valid Urja Meter Ops session — obtained by
logging into the portal themselves, exactly as a human user would in a
browser — and passes it on every request:

```
Authorization: Bearer <your-urja-session-token>
```

(`X-Urja-Session-Token: <token>` works too, as a convenience alias.)

This service forwards that token as the portal's session cookie on each
upstream call and does nothing else with it — no logging, no persistence,
no inspection. It's deliberately stateless with respect to auth: no session
store, no token-refresh logic, no "what happens when our stored session
expires" failure mode to design around. The trade-off, stated plainly: this
pushes the burden of obtaining a session onto whoever calls this API. That
was an intentional choice given the alternative is a service that holds a
long-lived portal credential at rest — see **architecture-decisions.md** in
the repo for the full reasoning, and REFLECTION.md for how this constraint
shaped the whole investigation, not just this one decision.

**Getting a token for local testing**: log into the portal in your own
browser, open DevTools → Application → Cookies, and copy the value of
`__Secure-better-auth.session_token`.

## Known limitations

- **No live per-meter hierarchy endpoint exists on the portal** (confirmed,
  not assumed — see PROTOCOL.md). `GET /api/meters/:meterId` therefore
  falls back to a snapshot of the portal's own bulk "Export all meters"
  download (`src/data/meter-export-snapshot.json`, committed as-is) for
  `installType`, `build`, and the full hierarchy. The DT *name* within that
  hierarchy is still always resolved live, since the embedded copy is known
  to go stale. This means hierarchy/installType/build can go out of date if
  the portal's topology changes after the snapshot was taken — the
  response's `sources` field always tells you which parts came from where.
- **No caching.** The dataset is small (403 meters, 40 DTs) and this is
  assignment-scope, so every request hits the upstream portal fresh.
  Flagged as the first thing to add if this needed to scale.
- **Pagination on `/api/transformers/:code/meters`** isn't implemented —
  it returns the full snapshot match in one response, since the largest DT
  has 13 meters.
- **Consumption window**: only ever observed a 7-day window for one meter.
  Whether that's fixed or a date-range parameter exists upstream is not
  confirmed.

## Running it

Requires Node.js 20+.

```bash
npm install
cp .env.example .env   # defaults are fine for local use
npm start               # or: npm run dev (auto-restart on change)
```

```bash
curl http://localhost:3000/health

curl http://localhost:3000/api/meters/J100000 \
  -H "Authorization: Bearer <your-urja-session-token>"

curl "http://localhost:3000/api/meters/J100000/consumption?delta=true" \
  -H "Authorization: Bearer <your-urja-session-token>"
```

### Exploring it without curl

Open **http://localhost:3000/docs** — an interactive API browser generated
from `openapi.json` ([Swagger UI](https://github.com/swagger-api/swagger-ui)).
Click **Authorize** top-right, paste your Urja session token, and you can
click through every endpoint and send real requests without a terminal.

## Testing

```bash
npm test
```

28 tests, all mocking the upstream portal with [`undici`'s `MockAgent`](https://undici.nodejs.org/#/docs/api/MockAgent)
(Node's built-in `fetch` is undici under the hood) against fixtures built
directly from real captured upstream responses — see `test/fixtures/`. No
automated test depends on a live portal session: they're deterministic,
don't risk rate-limiting or locking a real account, and don't need a
secret in CI.

Three end-to-end tests are worth reading first if you want to see the
project's thesis in one place:

- `GET /api/meters/J100400` in `test/integration/app.test.js` — proves the
  DT-007 stale-name bug is actually fixed, against the real anomalous data.
- `GET /api/meters/J100000` — proves the live/snapshot merge and its
  `sources` reporting work correctly.
- `test/unit/hierarchySnapshot.test.js` — proves the snapshot file itself
  reproduces the documented 403-meter, 40-DT dataset exactly.

## Project layout

```
src/
  app.js              Express app wiring
  server.js           Entry point
  config.js           Env-driven config
  routes/             HTTP layer — one file per resource
  services/urjaClient.js   All upstream HTTP calls, in one place
  utils/normalize.js  Every upstream-quirk fix, with the evidence in comments
  utils/errors.js     ApiError (our 4xx) vs UpstreamError (portal failed)
  middleware/         Auth pass-through, central error handling
  data/               The bulk-export snapshot + its loader
test/
  unit/               Pure-function tests (normalize.js, snapshot loader)
  integration/         Full request/response tests against mocked upstream
  fixtures/           Real captured upstream JSON, trimmed for tests
```
