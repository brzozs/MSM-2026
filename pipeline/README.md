# National ecology inputs and experimental calculations

National collector for [issue #13](https://github.com/brzozs/MSM-2026/issues/13). Python 3.11 or newer is sufficient; no packages need installing.

### Source forecasts, coverage gaps and measured migration

If a national collection stops at the weather provider's quota, `python -m pipeline.recover_cached_atlas` can publish today's fresh, fingerprint- and integrity-checked completed batches without making another network request. Missing grid locations receive a low-confidence inverse-distance estimate of the **index**, using four source forecast locations. The nearest source must be within 1,500 km; estimates can be poor at long distances. Every inferred point carries `is_predicted`, method, source IDs and nearest distance. It has zero real weather hours and no invented peak conditions. Missing nearest inputs remain unknown. This is an explicit experimental fallback, not equivalent to a local forecast or a validated tick-population model.

`python -u -m pipeline.measured_migration` attaches the latest complete UTC day's [public BirdCast NEXRAD profiles](https://aloftdata.github.io/getRad/reference/get_vpts.html). Collection is bounded to 170 U.S. radars, four concurrent requests and 8 MiB/profile; cached public profiles avoid repeated downloads. The parser uses non-gap 100 m density layers 200–3,000 m above radar altitude, at least 12 profiles and three layers/profile during civil night, calculated with [NOAA's solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF). Density is integrated to birds/km². Coverage and detectability vary; this is processed radar evidence, not species identification, individual tracks or tick-carriage measurements. Raw profiles stay outside public assets. Attribution: BirdCast / Cornell Lab of Ornithology; [source description](https://birdcast.org/data-interpretation/). Provider reuse terms must be confirmed before hosted redistribution.

Within 150 km of a valid radar, the separate experimental `tick_prediction_index` is `weather + 0.2 × min(1, log1p(density)/log(101)) × weather × (1-weather)`. **The 0.2 coefficient is an uncalibrated product assumption**, with at most five percentage points of adjustment. It has not been validated against tick surveillance or health outcomes. Source weather suitability remains unchanged. No radar, stale evidence or insufficient coverage means weather-only; no seasonal factor substitutes for measurements. The latest measured night is held across the weather forecast dates and is not represented as a forecast of bird movement. The fully gated habitat/tick-report composite remains separate and unavailable when its inputs are missing.

After either command, run `python -m pipeline.publish` and rebuild the frontend. The refresh workflow performs these stages automatically when activated; absent eBird credentials leave sightings unavailable while public radar collection remains independent. Scheduled activation still requires reviewed default-branch integration and Pages configuration. A workflow file on a task branch does not install a daily service.

From the repository root:

```bash
python3 -m unittest discover -s pipeline/tests -v
python3 -u -m pipeline --region US --output pipeline/output/latest.json
```

The default refresh covers **all 50 U.S. states plus D.C.** with one uniform 50 km reference lattice: 3,846 weather samples using the bundled boundaries. Every state uses its own local forecast inputs, the same coefficients, soil depths and seven-day UTC window. There is no Capital Region exception. A common fallback rule supplies a point for disconnected land components missed by the lattice, including islands and small jurisdictions. The first countrywide collection takes several minutes; completed public weather batches are cached so a failed run can resume.

The refresh fetches Open-Meteo, six selected eBird species and a bounded public iNaturalist tick query. It creates a national manifest, a lightweight map overview, and **51 state-sized JSON/GeoJSON snapshots**. Weather samples are reference model grid locations; they do not establish trail-level precision or tick occurrence. Bird/tick reports vary with the observations actually available, rather than forcing equal or invented counts per state.

The automatic grid reads `web/public/data/states.geojson` without changing it. Its [geography provenance](../web/public/data/README.md) remains applicable. `--boundaries` can point at the same approved geometry in another location. For a detailed state refresh, use the identical generator at a chosen spacing:

```bash
python3 -u -m pipeline --region US-WA --grid-spacing-km 25 --output pipeline/output/washington.json
```

This command creates a cached snapshot. A [prepared workflow](../.github/workflows/refresh-ecology.yml) can collect/build/publish twice daily after hosting setup; it is not activated by this local change. No database or Cloudflare account is needed for this static publication path.

## Display and refresh the map

After a successful national collection (exit 0 or usable partial-success exit 2):

```bash
python3 -m pipeline.publish
npm --prefix web run dev
```

The publisher copies only the manifest and its 52 referenced JSON generation files into ignored `web/public/data/ecology/`, excluding weather caches and environment files. It stages a complete generation before atomically replacing the public manifest; missing/invalid files or credential matches preserve the prior manifest. Existing public generations are immutable. The browser loads real UTC dates and state snapshots, checks the manifest every five minutes and on focus, and displays original source freshness. No published data means an explicit unavailable state.

The original UI, birds and wind remain. National state height/color and percentages show the mean available experimental weather suitability. The selected-state view uses a bounded green-to-orange heatmap instead of local percentages; simple county/city names remain. No heatmap is drawn nationally. Day transitions ease over 1.6 seconds with a small display-only settling lift, then finish at the exact target values, including when reduced motion is requested. Bird reports remain separate context. The original flapping flocks use broad seasonal guidance (northbound March–May, southbound September–November; otherwise no direction inferred), with approximate corridors rather than measured or species-specific tracks. Sources and month-convention limits are in `web/src/data/seasonalMigration.ts`. A combined bird/weather index remains withheld while report windows and habitat are incomplete; the heatmap explicitly identifies weather-only mode.

The workflow requests collection at **6:17 AM and 6:17 PM America/New_York**. These are collection times, not synchronized provider release instants. It accepts collector exit 0/2 only, builds public assets, and deploys only on success, preserving the last deployed site on failure. It has no push-triggered collection or automatic full-run retries. Extra manual collections share the provider budget. GitHub schedules may be delayed, run only from the default branch, and may be disabled after 60 days of public-repository inactivity ([official schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).

Activation still requires reviewed integration into the default branch and Pages configured to use GitHub Actions. `EBIRD_API_KEY` is optional for sightings and stays backend-only; public measured-radar migration does not require it. Those external activation steps have not been performed here. Provider reuse terms for hosted migration summaries must also be confirmed. Pages supplies its base path to the build; geography/data URLs honor that path. The existing 12-hour source freshness rule remains; delayed/failed runs can produce stale periods.

## Credentials

The backend reads `EBIRD_API_KEY` from the process environment first, then from **`pipeline/.env.local`**, which is ignored by Git. A separate checkout must supply its own backend configuration; a key is not included in the repository. Never put the key in a `VITE_` variable or a browser request.

For a separate checkout, copy `.env.example` to `.env.local`, restrict it with `chmod 600 pipeline/.env.local`, and enter the key privately in an editor. Do not put a key in a command argument, source file, issue, fixture or snapshot. In GitHub Actions, the same name should come from a repository secret, not a committed file.

Only requests to `https://api.ebird.org` get the `X-eBirdApiToken` header. The HTTP client refuses redirects and unapproved/non-HTTPS destinations. HTTP error bodies and headers are not logged or included in output. Publication checks the resulting bytes for the configured key before replacing any existing snapshot.

## What is actually calculated

The pure functions in `model.py` implement the existing [experimental model specification](../docs/superpowers/specs/2026-11-07-ecological-data-and-model.md#5-versioned-experimental-risk-engine). Version: `vectorcast-heuristic-v1`.

For each hour, `clip(x)` bounds a value to 0–1:

```text
temperature_factor = min(clip((soil_temperature_c - 7) / 8), clip((35 - soil_temperature_c) / 10))
humidity_factor = clip((relative_humidity_percent - 60) / 22)
vpd_factor = clip((1.2 - vapour_pressure_deficit_kpa) / 1.2)
moisture_factor = clip(soil_moisture_fraction / 0.3)
questing_suitability = temperature_factor × humidity_factor × vpd_factor × moisture_factor
```

The daily value is the maximum hourly suitability, with **at least 18 distinct valid UTC hours** required. `questing_index_0_to_100` is 100 times that value. `conditions_at_peak` and `factors_at_peak` explain the selected hour. An actual zero remains zero; missing factors yield null. The separate `>7°C and >82% RH` trigger is an example from the planning model, not a universal activity threshold.

Nighttime precipitation and low cloud cover give a separate weather-only stopover proxy: `max(0.6 × clip(rain_mm / 2) + 0.4 × cloud_fraction)` over valid `is_day=0` hours. No nighttime coverage means null. This is not measured migration or observed stopover fallout.

The core also implements the specified logarithmic bird/tick reporting proxies, habitat-weighted stopover potential and ecological activity formula. The live snapshot deliberately leaves those dependent components **null**: the recent eBird endpoint is a presence summary with local times and incomplete sampling effort; the broad iNaturalist query does not establish blacklegged nymph counts; an admitted habitat raster is not connected. These missing inputs are listed in each frame. Pathogen/community and measured movement layers are explicitly unavailable.

All scores are **experimental relative suitability**, not calibrated tick occurrence, bite or infection probabilities. Weather model values are not leaf-litter measurements. The temperature/humidity coefficients require ecological validation before a stronger interpretation.

## Source details and budgets

- **[Open-Meteo](https://open-meteo.com/en/docs):** ten hourly variables, GMT, m/s and up to seven forecast days; 6 cm soil temperature and 1–3 cm volumetric soil moisture. Preserve requested and returned grid coordinates. Reject provider samples shifted more than 25 km; this validation is unchanged. The selected-state display separately smooths reference estimates using a compact kernel within 1.5 published grid spacings (75 km on the current 50 km grid), clipped to the state. Pixels nearest a null reference remain transparent, and nulls never contribute zero. This coarse visualization does not create new measurements or trail-level estimates. Snapshots without published grid spacing retain the disclosed 25 km interpolation limit. The default national grid has 3,846 locations, collected in requests of at most 64. A batched HTTP request can still consume one quota unit per location. The response does not expose a coherent model initialization timestamp, so it remains null and these snapshots cannot establish predictive backtesting. Data attribution: Open-Meteo, CC BY 4.0; hosted free service is noncommercial ([terms](https://open-meteo.com/en/terms)).
- **[eBird](https://documenter.getpostman.com/view/664302/S1ENwy59):** `amerob`, `sonspa`, `ovenbi1`, `veery`, `woothr`, `comyel`; seven-day lookback, `includeProvisional=false`, at most 500 returned records per species. Six requests maximum, with early stop on authentication rejection. Capped or failed queries mark the source partial/unavailable. `locationPrivate=true`, invalid coordinates, unvalidated records and duplicates are excluded. `howMany` missing/`X` remains unknown. Preserve local `obsDt`; do not invent a timezone or connect unrelated sightings into tracks. Attribution to eBird/Cornell and the [API terms](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/) and [data-access terms](https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/) must accompany reuse. This noncommercial integration does not assume a guaranteed numerical provider rate limit.
- **[iNaturalist](https://api.inaturalist.org/v1/docs/):** Ixodida `51672`, research grade, seven observation-local calendar dates, CC0/CC BY, public/unobscured coordinates and known uncertainty no more than 1000 m. At most five 200-record pages. If a later page fails, records from earlier pages are kept and the source is `partial`; a failed first page is `unavailable`. Incomplete, changing or duplicate-filled queries are not complete windows. Per-record attribution and source links are retained; photos are omitted. Missing reports do not demonstrate tick absence. Follow the [API practices](https://www.inaturalist.org/pages/api+recommended+practices).

The UTC forecast window is pinned once at run start and requested with explicit Open-Meteo `start_date`/`end_date`, so a run crossing UTC midnight stays on one window; the weather source records it as `forecast_start_date`/`forecast_end_date` and frame dates follow it, not the generation clock. Local eBird times, UTC weather hours, observation dates, retrieval times and snapshot generation times remain separate. Bird/tick reports are held fixed across future frames; only forecast weather changes. Days 4–7 carry `outlook: "lower_confidence"`. Staleness is 12 hours after the **oldest underlying weather retrieval**, not 12 hours after reusing a cache. The map omits the stale-weather banner; source timestamps and freshness deadlines remain in the published data.

## National collection and cache

`weather_grid.py` sends at most 64 locations per provider request, paced at eight locations/second (below the provider's published 600 quota units/minute). A run is capped at 4,500 locations; the default national grid has 3,846. Each batch is checkpointed under ignored `pipeline/output/weather-cache/`, with a public-configuration fingerprint, content hash, pinned forecast start date and six-hour lifetime. Re-running the same grid/window reuses valid checkpoints. No key or eBird header belongs in these weather-only files.

Budget a full national refresh as 3,846 weather quota units. Two full refreshes/day use about 7,692 units; a 12-hour cadence is appropriate for the [published free limits](https://open-meteo.com/en/pricing). Copying the earlier pilot's 3–6 hour cadence to the full grid would exceed the 10,000/day budget. The collector itself installs no schedule. Shared usage by other processes is outside the per-run guard; provider errors remain explicit and previous output stays available.

Automatic national output is published as a new generation directory followed by an atomic manifest replacement. A failed state file or manifest never replaces the previous manifest. Keep the manifest and its referenced generation together. Older generations are retained until the team chooses a retention policy.

## Frontend handoff

The self-contained [TypeScript contract](contracts.ts) describes `EcologyAtlasManifest`, `EcologyOverview` and `EcologySnapshot`. It contains no runtime provider client or key handling. For the national command, fetch `latest.json` first; its `overview_url` supplies the national map and each `states[].snapshot_url` supplies full local factors. URLs are relative to the manifest URL. State-specific or custom-point commands produce an `EcologySnapshot` directly.

| State-snapshot field | Use |
|---|---|
| `frames[index].date` | Select an actual available UTC date. |
| `frames[index].weather_suitability` | Point GeoJSON for a heatmap or bounded interpolation. Use `questing_suitability` as 0–1 weight; exclude nulls, retain zero. |
| `properties.conditions_at_peak` | Soil temperature (°C), soil moisture (m³/m³), humidity (%), VPD (kPa), precipitation (mm), wind from direction (degrees) and speed (m/s) at the selected maximum. |
| `properties.valid_weather_hours` / `missing_inputs` | Explain availability and withheld values. |
| `observations.birds` / `observations.ticks` | Actual eligible report locations, separate from the modeled surface. Bird coordinate uncertainty remains unknown where the API does not provide it; do not promote it to fine-scale evidence. |
| `sources` | Provider status, separate scopes/windows, exclusions, attribution and retrieval times. Zero displayed records is not zero animals. |
| `generated_at` / `stale_after` | Freshness; compare both with the current time. |
| `unavailable_layers` | Withhold unsupported layers and show their reason. |

The national overview omits detailed peak-condition/factor objects to keep the landing payload smaller; load a state's snapshot for these. Every state file uses its own weather points and observation subset. A report exactly on a shared border is assigned once using the lexicographically first state code. Source-query totals keep their original U.S./provider scope; `displayed_record_count` refers to the state's eligible displayed subset. Records outside the bundled state land geometry are counted as unassigned, rather than attributed to the wrong state.

The timeline initially selects today's UTC forecast when available. After initialization, only a user's date-button click changes the selected date. Background refreshes, midnight, state selection and layer toggles preserve it. If a new collection drops that date, the map withholds its weather values and asks the user to select an available day; it never substitutes a different forecast silently. Bird motion has its own clock, pauses while the page is hidden or its layer is disabled, and does not restart when the selected day changes within the same migration season. All existing map and menu animations run even when the browser requests reduced motion.

Keep collector output outside public assets and use `python3 -m pipeline.publish` after success. The frontend now loads that published atlas; original flight/wind remains explicitly illustrative. Do not copy the weather-cache directory into the site. Public data must retain source attributions and terms; eBird data are not relabeled as CC BY.

Custom samples use a JSON array with `id`, `name`, `latitude` and `longitude`; IDs must be unique, coordinates finite, and the run at most 4,500 points (provider batches remain at most 64). Choose points within the intended region; the script does not perform county/H3 model allocation or infer unmeasured coverage:

```bash
python3 -m pipeline --region US-NY-083 --locations /path/to/selected-locations.json --output pipeline/output/selected-region.json
```

The eBird code in that command selects Rensselaer County; the weather locations are exactly the points supplied in the file. For the national command eBird uses `US`, and iNaturalist adds its U.S. place filter to the national query box. Capped and uneven reports remain explicit; the weather sampling policy is identical across all 51 jurisdictions.

Exit codes: **0** = snapshot published with all requested sources available; **2** = usable snapshot published with explicit partial/unavailable observation sources; **1** = refresh failed and previous output retained. No snapshot is replaced on failed weather, invalid dates/values, failed atomic replacement or a credential match. `pipeline/output/` is local generated data and is ignored by Git.
