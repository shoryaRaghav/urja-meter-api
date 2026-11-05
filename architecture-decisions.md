# Architecture Decisions (Phase 3)

Working notes for defending design choices in the interview. Each decision below exists specifically because of something verified in protocol-notes.md — nothing here is guessed ahead of the investigation.

## 1. Stack: Node.js + Express
Simple, minimal boilerplate, easy to document with OpenAPI, matches what was asked for. The real assignment text says tool choice doesn't affect scoring, so this is a "pick something you can defend" choice, not a requirement — defend it on fit (thin JSON-in/JSON-out proxy, small team, fast to read) rather than claiming it was mandated.

## 2. Service pattern: thin adapter / BFF
Our API's whole job is translating the portal's undocumented, inconsistent internal JSON into one clean, consistent, documented REST surface. It is not a general-purpose scraper and does not need HTML parsing — confirmed in Phase 2 that the portal already exposes `/portal/*` as JSON consumed directly by its own SvelteKit frontend.

## 3. Auth: stateless per-request pass-through (the one decision most worth defending)
**Decision**: our service never stores, logs, or manages Urja Meter Ops credentials or sessions. The caller of *our* API must already hold a valid Urja session (they log into the portal themselves, same as any human user would). They pass that session token to our API per request via a header (`Authorization: Bearer <token>` or `X-Urja-Session-Token`); our service forwards it as the `__Secure-better-auth.session_token` cookie on the upstream call and nothing more.

**Why**: this mirrors exactly how this investigation itself was conducted — at no point did the agent building this service touch a credential or replay a captured session; a human held the session and relayed data. Building the service's auth model as session pass-through, rather than the service owning its own login/session lifecycle, keeps that boundary consistent end to end: the service is stateless w.r.t. auth, there's no secret at rest to leak, no token-refresh logic, no "what happens when our stored session expires" failure mode to design around.

**Trade-off, stated plainly**: this pushes the burden of obtaining a session onto whoever calls our API — they need a valid cookie from the portal themselves. That's accepted and documented, not hidden, in README under "Authentication."

## 4. Resource design (maps to the 3 required data domains: meter details, network hierarchy, consumption)
- `GET /api/meters` — search/list → proxies `/portal/meters/search`
- `GET /api/meters/:meterId` — nameplate + normalized hierarchy + normalized geo merged into one object (we make 2 upstream calls server-side so the caller doesn't have to)
- `GET /api/meters/:meterId/consumption` — proxies `/portal/meters/:id/energy`; types normalized (numeric strings → numbers, `DD/MM/YYYY HH:mm` → ISO 8601); raw cumulative register values preserved (matches the portal) with an additional derived per-interval delta also offered rather than silently dropping or silently replacing the raw values — an explicit product decision, not scope creep, since "consumption" is a named required domain and the portal itself only exposes the cumulative register.
- `GET /api/transformers` — proxies `/portal/dts`; pagination normalized to match other list endpoints
- `GET /api/transformers/:code/meters` — derived/synthesized endpoint (not available on the portal itself — transformer rows aren't clickable, confirmed in Phase 2) by filtering meters by `dtCode`. Directly answers the assignment's ask about network hierarchy relationships the portal doesn't itself expose as a reverse lookup.

## 4b. Hierarchy snapshot fallback — confirmed necessary, not a placeholder
`/portal/meters/search` (the only live, confirmed per-meter endpoint besides `/geo` and `/energy`) was raw-captured and returns only `meterId, serialNo, make, phaseType, installStatus, dtCode` — no `installType`, no `build`, no hierarchy. So there is genuinely no live endpoint anywhere on the portal for a single meter's full network hierarchy; the only two places it exists are the bulk export and the SvelteKit page loader (decision #not-using-that, see PROTOCOL.md). This makes the bulk-export snapshot fallback in `GET /api/meters/:meterId` a **confirmed, permanent design decision**, not a stopgap pending more investigation. `GET /api/meters/:meterId` therefore merges two sources with explicit precedence and reports which source each part of the response came from (`sources` field in the response): live search result is authoritative for the fields it returns; the snapshot supplies `installType`, `build`, and `hierarchy`, which live search never returns at all.

## 5. Normalization responsibilities (fixed at our boundary, not left for API consumers)
- geo: `{latitude:"..", longitude:".."}` (strings) → `{lat: number, lng: number}`
- energy: numeric strings → numbers; date format → ISO 8601
- hierarchy: empty-string fields (`""`) → `null`, so "is this field present" is a reliable check
- DT naming: always resolved via `/portal/dts`, never trusted from the embedded `hierarchy.dt.name` on a meter record — directly because of the DT-007 finding (three meter records carry a stale/different DT name than the canonical transformer listing gives)

## 5b. Bulk data extraction: batched crawl + shared merge logic, metadata-only
`GET /api/meters/export` extends decision #3's auth model rather than inventing a second one: "authorised" means the caller already holds a valid Urja session, same header, same bar as every other endpoint — no separate bulk-access credential was introduced, because nothing in the assignment asked for one and adding one would be unverified scope creep.

**Batching, not per-meter fan-out**: naively, a bulk export could be built as a loop calling the existing single-meter logic 403 times. Rejected — that's 403+ individual `/portal/meters/search` calls (effectively a denial-of-service pattern against someone else's legacy system) for data a single paginated crawl already returns in ~21 calls. `searchAllMeters`/`listAllTransformers` in `urjaClient.js` each do one full paginated crawl (one for meters, one for DTs), and the per-record merge happens in memory afterward.

**Reused, not duplicated, merge logic**: the single-meter route and the bulk endpoint both resolve the same question — "for this meter, which fields come from the live search vs. the snapshot, and what's the canonical DT name" — so that logic was extracted into one function (`mergeMeterRecord` in `normalize.js`) and both routes call it. Avoids the two endpoints silently drifting apart on precedence rules over time.

**Metadata-only scope, not full data dump**: the export includes nameplate, hierarchy, and geo per meter, but not consumption. 403 meters × months of 30-minute readings is 100k+ rows — a different shape of problem (pagination/streaming/date-range filtering) that the assignment's "consumption" domain is already served by the per-meter endpoint, not a flat export. Documented as a scope boundary, not an oversight.

**Geo sourced from the snapshot here, not live**: the single-meter endpoint fetches `/geo` live per meter because one extra call for one meter is free. For 403 meters that's 403 extra live calls just for coordinates that are already in the snapshot — the same batching argument as above applies a second time, within one endpoint.

**Two output formats**: JSON (for programmatic consumers) and CSV via `?format=csv` (flattened, for a spreadsheet) — same data, same `sources` provenance per record, just reshaped.

## 6. Testing strategy
- Unit/integration tests mock the upstream `/portal/*` calls (e.g. with `nock`) using fixtures built directly from the raw JSON verified in Phase 2 (dts, geo, energy, bulk export sample) — deterministic, no live session required, doesn't hit the real portal or risk rate-limiting/locking the user's account.
- A separate, clearly-labeled manual smoke-test script (not part of the automated suite, not run in CI) can optionally hit the live portal using a session token from a local, gitignored `.env`, for a final human sanity check. Documented in README as optional.

## 7. Error handling
Upstream failures (4xx/5xx, network errors, timeouts) are translated to a consistent error envelope from our API — never a raw stack trace or passthrough of whatever shape the portal happens to fail with.

## 8. Explicitly out of scope for v1 (documented, not silently skipped)
- Caching: dataset is small (403 meters, 40 DTs) and this is a dev/assignment-scope service; premature caching adds complexity without a demonstrated need. Noted as future work.
- Session management / login automation: covered by decision #3 — deliberately not our service's job.
