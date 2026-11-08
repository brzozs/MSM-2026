# Public Ecology Backend Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this user-authorized inline implementation; write failing tests before production code.

**Goal:** Produce real, timestamped bird/tick evidence and weather-driven questing calculations for the frontend teammate.

**Architecture:** A small Python standard-library batch package fetches bounded source responses, runs pure calculations, and atomically writes public JSON/GeoJSON. React never calls authenticated providers. User scope update: use a uniform national grid for all 50 states plus D.C., with identical calculations and per-state snapshots; no Capital Region exception. Keep provider requests bounded and resume from cached public weather batches.

**Tech Stack:** Python 3.11+, unittest, urllib, JSON; existing frontend unchanged.

**Spec:** ../specs/2026-11-07-ecological-data-and-model.md, section 5; current user instructions narrow issue #13 to backend calculations while a teammate owns the frontend.

## Global Constraints

- Work on agent/13-public-ecology-data; preserve the primary checkout's discovery drafts.
- Own pipeline/** and this plan only. Leave web/src/**, web/package.json, existing assets and AGENTS.md unchanged.
- Zero paid services or new runtime dependencies; no database/provider setup or scheduled job.
- Read EBIRD_API_KEY privately; send X-eBirdApiToken only to api.ebird.org. No secrets in code, outputs, logs, fixtures or frontend bundles.
- Follow vectorcast-heuristic-v1 exactly; its coefficients are experimental choices, not validated ecological constants or probability estimates.
- Preserve forecast/observation/retrieval times and units; missing inputs remain null, not zero.
- Sightings do not establish movement paths, complete sampling effort, tick carriage or infection.
- Leave changes uncommitted; no push, merge, deployment or frontend integration.

## Review Focus

- Duplicate/missing UTC hours must not satisfy the 18-hour daily adequacy gate.
- eBird local timestamps and recent-per-location summaries must not become invented UTC tracks or complete 72-hour counts.
- Private/obscured/unlicensed or insufficient-precision tick records must not enter public point layers.
- A failed source must produce an explicit status; failed weather or an invalid snapshot must preserve the previous file.
- HTTP errors, credentials and generated artifacts must never leak a key into source, JSON, logs or a production bundle.

### Task 1: Pure ecological calculations

**Files:** pipeline/model.py; pipeline/tests/test_model.py.

**Interfaces:** calculate_hourly_questing(weather_hour), summarize_weather_day(hours, target_date), calculate_activity_components(questing_suitability, stopover_weather_proxy, bird_reports_72h, bird_window_complete, tick_reports_7d, tick_window_complete, habitat_suitability).

- [x] Write tests for favorable/boundary conditions, missing and non-finite inputs, physical ranges, the 18-unique-hour gate, UTC day isolation and missing/zero/incomplete report windows. Run and observe failure before implementation.
- [x] Implement the spec's temperature, humidity, VPD, moisture, nighttime precipitation/cloud proxy, logarithmic report proxies, stopover potential and ecological activity formula. Dependent outputs carry missing-input reasons.
- [x] Run python3 -m unittest discover -s pipeline/tests -p test_model.py -v. Expected: every calculation test passes.

### Task 2: Bounded provider adapters and private credentials

**Files:** pipeline/sources.py; pipeline/tests/test_sources.py; pipeline/.env.example; pipeline/.gitignore.

**Interfaces:** load_ebird_api_key, request_json, fetch_weather, fetch_bird_observations, fetch_tick_observations. Adapters return normalized public records plus source status, exact windows, retrieval time, filters, attribution and exclusions.

- [x] Write tests for the eBird header/URL, secret redaction, private and invalid records, missing counts/local times, weather array lengths/UTC/units/nulls, iNaturalist licenses/geoprivacy/precision, capped pagination and incomplete results. Observe failure first.
- [x] Implement six guild queries (amerob, sonspa, ovenbi1, veery, woothr, comyel), approved records only, canonical checklist/species deduplication. Preserve original local observation timestamps; do not infer headings or count complete effort from this feed.
- [x] Implement ten hourly Open-Meteo fields, GMT and m/s, at no more than 64 locations; preserve returned grid coordinates and disclose unavailable model initialization metadata.
- [x] Implement at most five 200-record iNaturalist pages for a seven-calendar-day bounding box, research grade, CC0/CC BY, public coordinates and known <=1000 m uncertainty. Mark truncated/failed windows explicitly.
- [x] Load the key only from the process environment or ignored pipeline/.env.local; move the existing local key out of the frontend environment file without displaying it. Tests use dummy values only.
- [x] Run python3 -m unittest discover -s pipeline/tests -p test_sources.py -v. Expected: all source/security fixtures pass without networking.

### Task 3: Reproducible snapshot and frontend handoff

**Files:** pipeline/snapshot.py; pipeline/__main__.py; pipeline/contracts.ts; pipeline/README.md; pipeline/tests/test_snapshot.py.

**Interfaces:** build_snapshot(locations, weather, bird_evidence, tick_evidence, generated_at), write_snapshot_atomically(snapshot, output_path). CLI: python3 -m pipeline --region US-NY --output pipeline/output/latest.json.

- [x] Write tests for seven date-aligned GeoJSON frames, finite JSON, zero/missing observations, incomplete eBird counts withholding avian/composite components, partial-source status, atomic failure preservation and credentials absent from generated output. Observe failure first.
- [x] Implement validated caller locations, hourly-to-daily model outputs, provenance and source status. The user-expanded national grid in Task 4 replaces the initial pilot default. Counts are fixed at retrieval; future frames change weather only. Missing habitat/complete avian counts withhold dependent indices.
- [x] Publish only validated finite JSON via temporary file + rename. Weather failures preserve last output. Optional observation failures remain explicit and cause a partial-success CLI exit status.
- [x] Document source terms/attribution, units/depths, sample coverage, the JSON/TypeScript handoff, private environment setup and exact run/test commands.
- [x] Run the complete backend fixture suite, one bounded live refresh and an output integrity check. Build the unchanged frontend and scan its bundle plus pipeline public artifacts for configured secret values without printing them. Expected: valid live weather/evidence, no credential matches, frontend build succeeds.
- [x] Obtain one independent read-only review, resolve blocking findings with regression tests, and report actual results and handoff in issue #13. Leave issue open pending frontend integration.

### Task 4: Equal national coverage (user scope update)

**Files:** pipeline/coverage.py; pipeline/tests/test_coverage.py; provider/cache, snapshot/CLI, contract and handoff additions under pipeline/**.

**Interfaces:** generate_sampling_locations(state_boundaries, region_code='US', spacing_km=50); fetch_weather_grid(locations, forecast_days, retrieved_at, cache_directory, progress_callback); publish_national_snapshot(snapshot, state_boundaries, output_path).

- [x] Write failing coverage tests for the exact 51 jurisdictions, equal spacing metadata, contained points, holes, antimeridian crossings, disconnected islands and a non-empty D.C. fallback. Use the existing public-domain state boundaries read-only.
- [x] Generate one latitude-aware globally anchored lattice at 50 km spacing, clipped to state geometry. Apply the same component fallback rule everywhere. State-specific/custom runs use the same model and configurable grid; no hardcoded pilot default.
- [x] Write failing tests for batches of at most 64 points, pacing below 600 quota units/minute, at most 4500 new points per run, six-hour public-weather cache reuse and corrupt/stale cache rejection. Preserve original data retrieval time when a cache is reused.
- [x] Implement bounded/resumable weather collection; national observation queries use US scope and maintain explicit caps/coverage. No scheduler or paid tier.
- [x] Write failing tests for 51 state snapshot files, unique observation assignment at borders, antimeridian assignment, an atomic last-published manifest and relative frontend URLs. Publish state-sized detailed frames and a lightweight overview; retain identical units/model/version in every state.
- [x] Run the national live refresh with progress, assert all 51 jurisdictions have genuine processed weather output or an explicit missing-input status, scan new public artifacts for configured keys, and refresh the independent review. Do not claim country coverage from the prior Capital Region smoke run.
