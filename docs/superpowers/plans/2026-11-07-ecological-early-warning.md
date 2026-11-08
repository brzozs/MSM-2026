# Ecological Early-Warning Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Use superpowers:subagent-driven-development only when delegated implementation is explicitly chosen. Track steps with the checkboxes below. Read AGENTS.md and the three specifications first.

**Goal:** Build the prompt branch's global ecological map, with traceable bird/tick observations, weather-driven stopover/questing estimates, regional pathogen evidence, and an experimental community index on a $0 operating budget.

**Architecture:** A React map reads immutable precomputed files through a capped static gateway, keeping ordinary visits away from FastAPI and Supabase. A Python batch package ingests admitted sources, joins pilot observations/weather/health evidence with H3 and PostGIS, computes versioned components, and atomically publishes snapshots. FastAPI supplies optional bounded details; failed providers leave usable static evidence.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, MapLibre GL JS, deck.gl, H3 v4; Python 3.13, Pydantic, FastAPI, httpx, psycopg, PostGIS, Pytest; Vitest and Playwright; GitHub Actions, Cloudflare Pages/Workers Free/R2 Standard, Supabase Free, optional Render Free.

**Spec:** [Project design](../specs/2026-11-07-ecological-early-warning-design.md), [sources and zero-cost operations](../specs/2026-11-07-ecological-sources-and-operations.md), [data/model/API contracts](../specs/2026-11-07-ecological-data-and-model.md).

**Source:** `prompt.txt` at `bd286e751e8638f76fb473fb812a152b0c5b4513`. **Planning issue:** [#6](https://github.com/brzozs/HackRPI-2026-MSM/issues/6). **Branch:** `plan/ecological-early-warning`.

## Global Constraints

- Operating budget: **$0.00; no paid upgrades, metered overages, or purchased domain.** Prefer losing freshness or temporarily disabling a service to spending money.
- Static snapshots serve the landing experience; **at least 95% of landing sessions must make zero FastAPI or Supabase requests.** The static R2 gateway is a file delivery service, not the modeling API.
- H3 indices are strings; longitude/latitude order is explicit at every boundary; computation timestamps are UTC.
- Keep observations, estimates, forecasts, surveillance periods, source precision, licenses, and missing data distinguishable in every output.
- Never present county-to-cell allocation as measured local pathogen prevalence, bird sightings as measured migration, or resident population as actual outdoor exposure.
- Start with a global basemap and honest coverage masks; compute detailed pilot data before expanding. Never create a dense worldwide resolution-7 forecast grid.
- Initial scored cohort: `ixodes-scapularis:nymph:borrelia-burgdorferi`. Model: `vectorcast-heuristic-v1`. All coefficients are the proposed prototype assumptions in the technical specification.
- Four map controls, globe/Mercator capability handling, the community drawer, and D-7 through D+7 time navigation remain product requirements. Publish only actually available frames.
- Names are verbose and unit-bearing. Start with focused source functions; extract shared patterns after the second duplication. No generic ETL framework, accounts, custom particle engine, or paid notifications in the pilot.
- Future execution needs issue claims and task branches. Commit/push/merge/deployment authorization remains separate; a checklist does not grant it. This planning task creates documents only.

## Review Focus

1. **Plausible-looking data with missing rights/denominators:** reject excluded records, categorical prevalence, hidden coordinates, and suppressed counts (Tasks 1, 3, 8).
2. **False spatial precision:** preserve county fragments and source scale, reject incomplete county allocation, conserve counts, and handle antimeridian/boundaries (Tasks 5, 8).
3. **Time inconsistency:** reject future knowledge, distinguish forecast initialization/validity, cover D+7, and cancel responses for old selections (Tasks 6, 10).
4. **Resource exhaustion:** bound WebGL buffers, database bytes, R2 reads/storage, and publication sizes; retain last-good data when blocked (Tasks 2, 5, 7, 11).
5. **Misleading degraded operation:** expose sparse/stale/missing feeds, unsupported globe layers, sleeping API, reduced motion, and WebGL loss without fabricated fallback observations (Tasks 2, 4, 9, 10).

## Proposed file structure

These are future implementation paths; none is created by the planning task.

| Path | Responsibility |
|---|---|
| `web/src/contracts.ts`, `shared/schemas/`, `tests/fixtures/` | Typed public boundaries, generated JSON Schemas, small licensed/synthetic golden fixtures. |
| `web/src/map/`, `web/src/components/`, `web/src/data/`, `web/src/alerts/` | Map lifecycle/layers; HUD/drawer; manifest loading; local saved-area comparisons. |
| `src/vectorcast/contracts.py`, `config/` | Python canonical public models, source registry, cohort/model parameters, pilot region/anchor configuration. |
| `src/vectorcast/sources/`, `src/vectorcast/normalization.py` | Provider-specific clients, pagination, provenance, license/quality admission and deduplication. |
| `src/vectorcast/spatial.py`, `src/vectorcast/baselines.py`, `db/` | H3 geometry, PostGIS migrations/queries, region/habitat/population baselines and bounded storage. |
| `src/vectorcast/weather.py`, `src/vectorcast/model.py`, `src/vectorcast/health.py` | Forecast inputs, pure versioned equations, source-typed health evidence and conservative allocation. |
| `src/vectorcast/publishing.py`, `src/vectorcast/pipeline.py` | Byte/quota gates, immutable generation artifacts, atomic pointer update, source checkpoints. |
| `src/vectorcast/api.py`, `gateway/` | Optional FastAPI read endpoints; a minimal private-R2 static delivery worker. |
| `tests/`, `web/tests/`, `.github/workflows/` | Meaningful math/spatial/API/browser tests, CI and separately authorized publishing. |

One owner controls `contracts.py`, generated schemas, and shared fixtures until the contract task lands. Agree interface changes in issues before changing shared fields. The lanes below are suggested responsibilities, not assignments of people or agents.

---

## Phase 1: Full-screen map and real observations

### Task 1: Establish validated public contracts and a reproducible fixture generation

**Files:** Create `pyproject.toml`, `uv.lock`, `src/vectorcast/contracts.py`, `scripts/export_json_schemas.py`, `shared/schemas/`, `tests/fixtures/`, `tests/test_contracts.py`, `web/src/contracts.ts`. Minimal web package/tooling belongs with Task 2.

**Interfaces:** Produce Pydantic `MetricValue`, `Observation`, `SourceBatch`, `WeatherHour`, `ModelInputs`, `ModelComponents`, `RegionFrame`, `SnapshotManifest`, and `CellEvidence` models matching technical-spec sections 1 and 5–7. `MetricValue.value` is `float | None`; status/reasons/source precision are mandatory. Produce `export_public_schemas(destination_directory: Path) -> None`; TypeScript reads the same wire contract.

- [ ] Write `test_rejects_nan_and_missing_null_reason`, `test_h3_stays_string`, `test_example_manifest_is_explicitly_marked`, and `test_generation_and_source_metadata_required`. Assert non-finite values reject, H3 remains a string on a JSON round trip, and null without a reason rejects.
- [ ] Run `uv run pytest tests/test_contracts.py -q`; establish a failing contract assertion before implementing its behavior.
- [ ] Implement only the models/export and a tiny synthetic generation with full source/provenance labels, one unknown county metric, and two dates. Define UTC date/cohort/generation fields once; prohibit implicit NaN conversion.
- [ ] Run the same tests and `uv run python scripts/export_json_schemas.py`; verify generated schemas and fixtures agree. These commands become available during this task, not during planning.
- [ ] Record the focused diff, contract names, and checks in the task issue; take an authorized commit checkpoint before dependents start.

### Task 2: Build a fixture-driven map shell and verify projection capability

**Files:** Create `web/package.json`, lockfile, `web/index.html`, Vite/TypeScript/Tailwind configuration, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/map/EcologicalMap.tsx`, `web/src/map/layers.ts`, `web/src/components/RegionEvidenceTable.tsx`, `web/tests/map-shell.spec.ts`.

**Interfaces:** Consume Task 1 `RegionFrame`. Produce `EcologicalMap({regionFrame, projection, selectedLayer, reducedMotion, onSelectCell})`; projection is `"globe" | "mercator"`, selection yields an H3 string. A table exposes the same selected-region evidence without WebGL.

- [ ] Write browser checks for a fixture cell selection, four named layer controls, projection switching, reduced motion, and WebGL2 unavailable. Assert region evidence remains selectable in the fallback table.
- [ ] Run `npm --prefix web run test:e2e -- map-shell.spec.ts`; confirm the intended behavior is initially absent.
- [ ] Install mutually compatible stable React 19/MapLibre/deck.gl versions and lock them. Prove interleaved Mercator first; test the current supported integration module and each globe primitive. Use precomputed H3/polygon equivalents for unsupported globe aggregations. Show four explicit layer states, not fabricated live layers.
- [ ] Add the dark hosted basemap with visible attribution, one shared context, bounded buffers, stable layer IDs, cleanup and context-loss recovery. Require table fallback on map failure.
- [ ] Run the browser checks and `npm --prefix web run build`; record the compatibility matrix and actual package versions. A build alone is not evidence of correct globe rendering.

### Task 3: Ingest licensed tick and guild-bird observations

**Files:** Create `config/source_registry.json`, `config/ground_foraging_guilds.json`, `src/vectorcast/sources/inaturalist.py`, `src/vectorcast/sources/ebird.py`, `src/vectorcast/normalization.py`, `tests/test_observation_sources.py`, provider-response fixtures.

**Interfaces:** Consume `Observation`/`SourceBatch`. Produce `fetch_tick_observations(http_client: httpx.Client, source_configuration: dict, observed_since: datetime) -> SourceBatch`, `fetch_bird_observations(http_client: httpx.Client, source_configuration: dict, observed_since: datetime) -> SourceBatch`, and `normalize_observations(source_batch: SourceBatch) -> list[Observation]`. SourceBatch contains query coverage, checkpoint, status, request/byte counts and rejected-record reasons.

- [ ] Test recorded responses for pagination, edited overlap records, duplicate origin IDs, restrictive/unknown licenses, hidden/uncertain coordinates, unknown life stage, 429 retry, 401, missing eBird key, and changed schema. Assert an absent key yields unavailable bird evidence; a failed query never becomes zero birds.
- [ ] Run `uv run pytest tests/test_observation_sources.py -q` and observe the failing cases before implementation.
- [ ] Implement bounded httpx clients with the operations spec's timeouts, retry limits, 30/minute iNaturalist project cap, 100/day eBird project cap, 48-hour overlap and explicit source admission. Store credentials only server-side. Keep raw sightings distinct from migration telemetry.
- [ ] Export an observation-only fixture/live generation for the map boundary, never putting credentials or raw restrictive records in web bundles. No PostGIS requirement for this first bounded export.
- [ ] Run the fixture tests; when valid credentials are available, run one bounded pilot fetch and record source counts/time/license results. If access is absent, verify the unavailable state and label the live check unperformed.

### Task 4: Connect observation snapshots to the HUD and community drawer

**Files:** Create `web/src/data/snapshots.ts`, `web/src/components/LayerControls.tsx`, `web/src/components/CommunityDrawer.tsx`, `web/src/components/SourceStatus.tsx`; modify `App.tsx`/`layers.ts`; add `web/tests/observations.spec.ts`.

**Interfaces:** Produce `loadSnapshotManifest(manifestUrl: string, abortSignal: AbortSignal): Promise<SnapshotManifest>` and `loadRegionFrame(regionFrameUrl: string, abortSignal: AbortSignal): Promise<RegionFrame>`. Drawer consumes the original county/context fields; all data loading is through the static boundary.

- [ ] Test a fresh report, stale feed, unavailable eBird, unknown region, invalid manifest schema, keyboard selection/focus, and a geolocation denial. Assert no movement trail is constructed from unrelated sightings and no synthetic fixture is labeled live.
- [ ] Run the targeted browser suite; implement the plain region selector, four toggles with clear status, per-layer legend, drawer source links/date/precision and opt-in geolocation.
- [ ] Render tick reporting intensity and bird sightings using their separate primitives; retain disabled/explained model layers until their real outputs exist. Keep selected region usable when the basemap fails.
- [ ] Run `npm --prefix web run test` and the targeted browser suite. Record a Phase 1 demo: open → select county → inspect original record/source → demonstrate missing feed.

**Phase 1 gate:** a fixture demo and the available live pilot adapters work, all four controls expose honest status, and the map/table remains usable without a model/API account.

## Phase 2: Spatial baselines, ecological model, and static publishing

### Task 5: Add the bounded PostGIS/H3 working set and habitat baselines

**Files:** Create `db/migrations/001_ecology.sql`, `db/queries/region_intersections.sql`, `src/vectorcast/spatial.py`, `src/vectorcast/baselines.py`, `config/pilot_regions.json`, `tests/test_spatial_integration.py`, `tests/test_storage_budget.py`, `compose.yaml` for local PostGIS testing.

**Interfaces:** Produce `candidate_cell_ids(region_geojson: dict, h3_resolution: int) -> list[str]`, `observation_cell_id(latitude_degrees: float, longitude_degrees: float) -> str`, `prepare_region_baselines(database_connection, region_ids: list[str]) -> None`, and `assert_database_budget(database_size_bytes: int, projected_batch_bytes: int) -> None`.

- [ ] Write integration fixtures for `01001` FIPS, a boundary point, a polygon hole/island, an antimeridian polygon, a pentagon and res-5/res-7 intersections. Assert boundary counts occur once and area sums match the covered region within stated tolerance.
- [ ] Test the budget guard at a projected database size of 400,000,000 bytes; it must reject before batch commit. Include existing extension/index usage in the simulated/measured baseline.
- [ ] Start local PostGIS, apply the proposed schema, and establish the failing query/geometry assertions. Implement the exact geometry/indexing logic from the technical spec with overlap coverage and geodesic areas.
- [ ] Admit and crop dated county boundaries and WorldCover baseline windows; retain NoData and original resolution. Cap prepared rows to 10,000 res-5 plus 10,000 res-7 cells, and database observations to 50,000/30 days.
- [ ] Run `uv run pytest tests/test_spatial_integration.py tests/test_storage_budget.py -q` against local PostGIS. Record measured schema/database bytes; no claim that row-count estimates guarantee provider fit.

### Task 6: Implement weather alignment and the pure ecological equations

**Files:** Create `src/vectorcast/weather.py`, `src/vectorcast/model.py`, `config/model_parameters.json`, `config/weather_anchors.json`, `tests/test_weather.py`, `tests/test_model.py`.

**Interfaces:** Produce `fetch_weather_forecast(http_client: httpx.Client, anchor_configuration: dict, forecast_initialized_before: datetime) -> list[WeatherHour]`, `compute_model_components(model_inputs: ModelInputs) -> ModelComponents`, and `compute_community_index(ecological_index: float | None, pathogen_prevalence: float | None, population_factor: float | None) -> MetricValue`. Eligibility checks gate composite inputs before this pure multiplication.

- [ ] Write golden assertions: all eligible ecological inputs one and prevalence 0.2 → index 20; missing prevalence → null; negative/non-finite values reject; soil exactly 7/RH exactly 82 fail the strict example trigger. Pin avian/stopover/questing equations to the technical spec.
- [ ] Test heading direction/sign, absent heading selecting the named proxy mode, no nighttime hours, fewer than 18 valid weather hours, anchor distance over 25 km, and a forecast initialized after the frame cutoff.
- [ ] Run the two targeted Pytest files; implement the pure functions with no HTTP/database coupling in `model.py`. Keep each component, adequacy fields, reasons, and explicit mode/version in output.
- [ ] Fetch at most 200 pilot anchors, request **eight inclusive forecast days** for today through D+7, conserve the effective-call budget, and retain forecast initialization/valid hours. Future report counts persist at the generation cutoff with that assumption visible.
- [ ] Run `uv run pytest tests/test_model.py tests/test_weather.py -q`; verify D+7 has 24 forecast slots when the provider supplies them. Keep missing/stale eligibility separate from valid low suitability.

### Task 7: Publish atomic snapshots with provable budget limits

**Files:** Create `src/vectorcast/publishing.py`, `src/vectorcast/pipeline.py`, `gateway/src/index.ts`, `gateway/wrangler.jsonc`, `tests/test_publication.py`, `gateway/tests/delivery.test.ts`, `.github/workflows/refresh-ecology.yml`, bounded output fixtures.

**Interfaces:** Produce `build_generation(source_batches: list[SourceBatch], generated_at: datetime) -> SnapshotManifest`, `publish_generation(manifest: SnapshotManifest, storage_client, budget_state: dict) -> None`, and worker `fetch(request: Request, environment, executionContext): Promise<Response>`. File access is allowlisted to published `public/v1/` objects.

- [ ] Test an interrupted artifact upload, missing checksum target, unapproved license, private fields, oversized shard, exhausted operation/storage allowance, duplicate rerun, and concurrent job. Assert `current.json` changes only after every referenced object validates.
- [ ] Test the gateway rejects arbitrary/private paths and multi-range requests before object access. A cache miss performs at most **one R2 operation**; GET/HEAD/range semantics and 206/416/encoding/CORS are verified. There is no public bucket bypass.
- [ ] Run `uv run pytest tests/test_publication.py -q` and the gateway test script; implement immutable prefixes, manifest-last publication, successful-source checkpoints, retention, gzip JSON and uncompressed PMTiles delivery.
- [ ] Add `17 */6 * * *`, one concurrency group, manual dispatch, 15-minute timeout, source-specific schedules, bounded retries and no auto-paid fallback. Workflow cron becomes active only on the repository's default branch after authorized integration.
- [ ] Verify the 31-day read bound (at most 3.1 million gateway reads plus 100,000 ETL/admin reads), stored bytes below 7.5 GB, class-A operations below 100,000/month, and last-good Pages fallback. If account-wide usage cannot satisfy the bound, leave R2 delivery disabled.
- [ ] Run an entirely local storage-mock pipeline, inspect object hashes/headers and failure rollback, and record which provider checks remain unperformed until deployment is authorized.

**Phase 2 gate:** a repeatable generation computes pilot components, publishes through an atomic static contract, and degrades to a dated last-good snapshot without exceeding configured resource ceilings.

## Phase 3: Pathogen evidence, community interpretation, and time navigation

### Task 8: Integrate typed health evidence and conserving population/allocation logic

**Files:** Create `src/vectorcast/sources/health.py`, `src/vectorcast/health.py`, `db/queries/allocate_county_context.sql`, `tests/test_health.py`, `tests/test_health_allocation_integration.py`; extend baseline import for GHSL and the registry for CDC/NYSDOH/NEON products.

**Interfaces:** Produce `normalize_health_record(source_id: str, original_record: dict) -> RegionalHealthMetric`, `allocate_county_context(database_connection, health_metric_id: str, knowledge_cutoff: datetime, taxon_identifier: str, life_stage: str) -> list[CountyCellContext]`, and `is_composite_eligible(model_inputs: ModelInputs) -> tuple[bool, list[str]]`. Define the two additional Pydantic models in `contracts.py` and regenerate schemas under the contract owner's review.

- [ ] Test real-shaped metadata/records for NYSDOH dataset `kibp-u2ip`, CDC cumulative presence and NEON product identifiers. Assert human cases, presence-only records, suppressed/zero denominators and alpha-gal context cannot become tick-test prevalence.
- [ ] Write SQL integration assertions that weights sum to one, allocated positives/tests conserve county totals within `1e-9` relative tolerance, and fragment prevalence equals the original ratio. A partial county, including a partial res-7 shard, must refuse full allocation.
- [ ] Run both targeted health test files; implement the exact weighted allocation formula, retain county/cohort/date/precision, and preserve separate contexts for a two-county H3 cell.
- [ ] Admit the selected population epoch and compute pixel-overlap count sums. Enforce composite input gates: at least 20 tests, three eligible tick reports, three guild bird reports, known habitat/population, current weather, complete windows, and a health period no older than three years.
- [ ] Re-run the math/spatial/health suites. Inspect a drawer-shaped output for measured testing versus modeled allocation, including a null composite where evidence is insufficient. No eligible denominated dataset means a functioning health-context layer with unavailable composite.

### Task 9: Add optional bounded FastAPI detail reads

**Files:** Create `src/vectorcast/api.py`, `src/vectorcast/queries.py`, `tests/test_api.py`, optional `render.yaml`; do not provision Render yet.

**Interfaces:** Implement the five GET endpoints in technical-spec section 7 with the exact verbose query names and `CellEvidence`/regional schemas. Create `get_cell_evidence(h3_cell_id: str, generation_id: str, target_date: date, cohort_id: str) -> CellEvidence` through a dependency-injected read-only repository.

- [ ] Test malformed H3, unsupported resolution/cohort/date/metric, excessive/wrapped bbox, 500-cell overflow, missing generation, SQL-injection-shaped identifiers, and expired dynamic generations. Assert structured 422/404/409/429/503 behavior and a static alternative where applicable.
- [ ] Test the configured API database role can SELECT only allowed curated data, cannot modify any table, and browser/anonymous roles cannot query working tables. Establish the failing authorization assertion before adding grants/policies.
- [ ] Run `uv run pytest tests/test_api.py -q`; implement parameterized queries, a two-second statement timeout, a small pool, fixed result limits and cache headers. No public write endpoint or arbitrary upstream URL.
- [ ] Add optional shared rate limiting only if the API is enabled; use the documented Upstash budget and fail closed. Keep the source/model pipeline independent of Render wakeups.
- [ ] Repeat API tests with simulated sleeping/unavailable storage. Confirm web landing and static drawer paths need no API connection.

### Task 10: Finish four data layers, the time bar, and local area alerts

**Files:** Extend `web/src/map/layers.ts`, `CommunityDrawer.tsx`, `snapshots.ts`; create `web/src/components/TimeScrubber.tsx`, `web/src/alerts/savedAreas.ts`, `web/tests/community-map.spec.ts`, `web/src/alerts/savedAreas.test.ts`.

**Interfaces:** Layer factory `createEcologicalLayers(regionFrame: RegionFrame, selectedLayers: string[], animationTimeSeconds: number): Layer[]`; saved-area function `compareSavedArea(previousFrame: RegionFrame, currentFrame: RegionFrame): AreaChange | null`; frame loader retains Task 4's cancellation contract.

- [ ] Test all four data/source/renderer/legend mappings, county/cell drawer context, D-7/D+7 positions with unavailable dates disabled, and explicit example/forecast/historical labels. A county presence-only record cannot paint precise local prevalence.
- [ ] Test rapid scrubbing with out-of-order responses: only the latest selected date/generation may display. Test sparse coverage, stale weather, no prevalence, a failed optional API, no WebGL, and reduced motion.
- [ ] Implement the layer table from the design, mutually exclusive opaque fills, version-stable color ramps, one expensive aggregation, lazy date/viewport loading, and at most three decoded frames/32 MB. Use actual trajectories only when legally available; otherwise retain observation/stopover rendering and explain the absent movement feed.
- [ ] Implement locally saved region IDs and in-app change notices. Emit a change only across complete compatible generations with the same cohort/model/source mode; use an initial index-change threshold of 10 points, explicitly a product default, not an official public-health threshold. No background/email/push promise.
- [ ] Run `npm --prefix web run test`, targeted Playwright tests, and the production build. Verify keyboard focus, screen-reader labels, visible attribution/precision/date, and clear original-versus-modeled health values.

### Task 11: Verify release budgets and document the deployment/handoff

**Files:** Create `.github/workflows/verify.yml`, `docs/runbooks/ecological-release.md`, `web/tests/static-budget.spec.ts`; finish deployment configuration and README run instructions for the actual implementation.

**Interfaces:** Consume the complete local pipeline, web build and gateway contract; produce a dated verification record with app commit, generation/model/source versions, fixture/live distinction, named-device performance, provider entitlement checks and rollback instructions.

- [ ] Write a landing network test with 100 fresh sessions and assert zero FastAPI/Supabase requests. Assert the initial manifest/overview budgets, 500 KB compressed region shards, correct gzip/range headers and stale/fallback behavior.
- [ ] Run `uv run pytest`, `npm --prefix web run test`, TypeScript check, web production build, gateway tests and `npm --prefix web run test:e2e`. Use local PostGIS and deterministic HTTP fixtures in CI; keep live calls outside ordinary test runs.
- [ ] On a named desktop and phone, record a 30-second pan/time-scrub with enabled layers. Target desktop median 60 FPS/p95 frame time ≤33 ms, mobile median ≥30 FPS; test ten projection/unmount cycles and context loss. Reduce layer counts/DPR before claiming a target missed by the measured devices.
- [ ] Check first useful map/evidence within the design's three-second target on a recorded network profile; measure the prompt's 100 ms only as a warm snapshot-response target. Report actual values and any missed goals.
- [ ] Recheck provider free-plan entitlements, existing account usage, private bucket/no-bypass, Free gateway request cap, source terms/keys and the projected monthly budget. Rehearse failed source, oversized batch, DB ceiling, incomplete upload, quota exhaustion and app/data rollback using local/provider test environments as authorized.
- [ ] Obtain independent current-diff audit, record issue handoff and remaining access/coverage limits, then use the user's separately authorized integration/deployment path. Without deployment authorization, deliver verified local artifacts and instructions; do not claim the site is live.

## Hackathon cut line and work order

For a three-person, approximately 24-hour build, use this proposed schedule; it is an estimate rather than a delivery guarantee:

| Window | Map/interaction lane | Data/model lane | Publishing/verification lane |
|---|---|---|---|
| Hours 0–2 | Share Task 1 contract review and Task 2 compatibility spike | Source access/license check; contract fixtures | Confirm free accounts and static fallback; issue ownership |
| Hours 2–7 | Task 2 map shell, then Task 4 observation HUD | Task 3 observation adapters | Task 5 pilot geometry/storage checks |
| Hours 7–13 | Task 4 demo/accessibility; consume fixture components | Task 6 weather/model | Task 7 local pipeline and static publication |
| Hours 13–18 | Task 10's available component layers/drawer | Task 8 one genuine health-context source; composite only if eligible | Task 7 failure handling, selected Task 11 checks |
| Hours 18–24 | Freeze scope and polish the demonstration | Validate sources/model and explain absent data | Actual-device checks, independent audit, release/handoff |

Keep API deployment, full res-7 allocation, radar extraction, custom particles, account-backed saved areas and broader regions outside the demo critical path. These remain ordered follow-up work, not deleted product goals. The dependency order is **1 → 2/3 → 4**, **1/3 → 5 → 6 → 7**, **5/6 → 8**, then **8 → 9/10 → 11**; owners may overlap independent file work only after agreeing contracts and issue claims.

## Planning verification and execution boundary

The planning deliverable covers all eight prompt sections through the linked specs and task assignments. Documentation review checks source commit, link targets, consistent formulas/names, forecast range, scope, and requirement coverage. It does not substitute for future runtime database, browser, provider, or model-validation tests.

Review the proposed choices before implementing. Start execution with Task 1 on a new implementation issue/task branch, preserving this plan as the reviewable baseline. Do not reuse the car-carbon model, prototype assumptions, Databricks design, or its outstanding PRs as requirements for this pivot.
