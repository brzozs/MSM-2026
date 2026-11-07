# Ecological Platform: Data, Spatial Model, and API Contracts

**Date:** November 7, 2026. **Status:** proposed contracts and reference snippets; no migrations, models, or endpoints have been executed or implemented.

Read with the [project design](2026-11-07-ecological-early-warning-design.md), [sources and operations](2026-11-07-ecological-sources-and-operations.md), and [implementation plan](../plans/2026-11-07-ecological-early-warning.md).

## 1. Shared conventions

- H3 v4 indices are lowercase hexadecimal **strings**, never JavaScript numbers. Validate with the H3 library, not only a regex. Store resolution explicitly. [H3 Python API](https://uber.github.io/h3-py/api_quick).
- GeoJSON/PostGIS positions are `[longitude, latitude]`; `h3.latlng_to_cell` takes `(latitude, longitude, resolution)`. Use named parameters at that boundary.
- Internal units: meters, square meters, degrees Celsius, relative humidity in percent, VPD in kPa, wind in m/s, precipitation in mm/hour, and soil moisture in m³/m³. API variable `vapour_pressure_deficit` uses the provider's British spelling. [Weather reference](https://open-meteo.com/en/docs).
- UTC ISO-8601 timestamps distinguish `observed_at`, `retrieved_at`, `forecast_initialized_at`, `valid_at`, `generated_at`, and health `period_start`/`period_end`. Dates label UTC days. Keep source timezone/date-only precision in metadata; do not invent observation hours.
- Component statuses: `fresh`, `stale`, `unavailable`, `insufficient_data`, `not_applicable`. A null value always has a reason; zero is a valid measured/modeled value only with eligible evidence.
- `cohort_id` identifies tick species, life stage, and pathogen separately, initially `ixodes-scapularis:nymph:borrelia-burgdorferi`. Unknown life stages remain context observations, rather than being pooled into nymph testing.
- `source_refs` identify approved registry entries. Every metric carries source period, original spatial scale, and model version where applicable. Confidence describes input adequacy; it is not a calibrated probability.

## 2. Proposed PostgreSQL + PostGIS DDL

The schema below is the complete initial working catalog. It deliberately excludes raw raster pixels, radar scans, full weather forecasts, users, and historical global cell frames. Those belong in bounded object files or later migrations. Run migrations with the configured database owner; support an existing PostGIS installation in `public` or `extensions`.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS ecology;
SET search_path TO ecology, public, extensions;

CREATE TABLE source_registry (
    source_id text PRIMARY KEY,
    provider_url text NOT NULL,
    dataset_identifier text NOT NULL,
    license_name text NOT NULL,
    terms_url text NOT NULL,
    attribution_text text NOT NULL,
    redistribution_approved boolean NOT NULL DEFAULT false,
    permission_reviewed_on date,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE source_runs (
    generation_id text NOT NULL,
    source_id text NOT NULL REFERENCES source_registry,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    run_status text NOT NULL CHECK (run_status IN ('running','complete','failed')),
    request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    downloaded_bytes bigint NOT NULL DEFAULT 0 CHECK (downloaded_bytes >= 0),
    checkpoint jsonb,
    error_code text,
    PRIMARY KEY (generation_id, source_id)
);

CREATE TABLE health_regions (
    region_id text PRIMARY KEY,
    region_type text NOT NULL CHECK (region_type IN ('county','state','country','health_region')),
    country_code text NOT NULL,
    county_fips text CHECK (county_fips ~ '^[0-9]{5}$'),
    region_name text NOT NULL,
    boundary_version text NOT NULL,
    geometry geometry(MultiPolygon,4326) NOT NULL,
    CHECK (ST_IsValid(geometry))
);
CREATE INDEX health_regions_geometry_index ON health_regions USING gist (geometry);

CREATE TABLE h3_cells (
    h3_cell_id text PRIMARY KEY CHECK (h3_cell_id ~ '^[0-9a-f]{15}$'),
    h3_resolution smallint NOT NULL CHECK (h3_resolution IN (5,7)),
    geometry geometry(MultiPolygon,4326) NOT NULL,
    habitat_suitability double precision CHECK (habitat_suitability BETWEEN 0 AND 1),
    habitat_model_version text,
    population_count double precision CHECK (population_count >= 0),
    population_baseline_year smallint,
    baseline_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    CHECK (ST_IsValid(geometry))
);
CREATE INDEX h3_cells_geometry_index ON h3_cells USING gist (geometry);

CREATE TABLE observations (
    canonical_origin_id text PRIMARY KEY,
    source_id text NOT NULL REFERENCES source_registry,
    source_record_id text NOT NULL,
    generation_id text NOT NULL,
    observation_kind text NOT NULL CHECK (observation_kind IN ('tick','bird')),
    taxon_identifier text NOT NULL,
    life_stage text,
    observed_at timestamptz NOT NULL,
    retrieved_at timestamptz NOT NULL,
    geometry geometry(Point,4326) NOT NULL,
    coordinate_uncertainty_meters double precision CHECK (coordinate_uncertainty_meters >= 0),
    h3_resolution_5_cell_id text REFERENCES h3_cells(h3_cell_id),
    public_point_eligible boolean NOT NULL DEFAULT false,
    quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
    record_license text NOT NULL,
    attribution_text text NOT NULL,
    original_record_url text NOT NULL,
    UNIQUE (source_id, source_record_id),
    FOREIGN KEY (generation_id, source_id) REFERENCES source_runs,
    CHECK (ST_X(geometry) BETWEEN -180 AND 180),
    CHECK (ST_Y(geometry) BETWEEN -90 AND 90)
);
CREATE INDEX observations_geometry_index ON observations USING gist (geometry);
CREATE INDEX observations_cohort_time_index
    ON observations (observation_kind, taxon_identifier, life_stage, observed_at);

CREATE TABLE regional_health_metrics (
    health_metric_id text PRIMARY KEY,
    source_id text NOT NULL REFERENCES source_registry,
    region_id text NOT NULL REFERENCES health_regions,
    cohort_id text NOT NULL,
    metric_kind text NOT NULL CHECK (metric_kind IN
        ('tick_testing','pathogen_presence','human_cases','ed_rate','allergy_context')),
    period_start date NOT NULL,
    period_end date NOT NULL,
    numerator double precision CHECK (numerator >= 0),
    denominator double precision CHECK (denominator >= 0),
    presence_status text CHECK (presence_status IN ('present','not_detected','no_records')),
    is_suppressed boolean NOT NULL DEFAULT false,
    source_spatial_scale text NOT NULL,
    source_record_url text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    CHECK (period_end >= period_start),
    CHECK (metric_kind <> 'tick_testing' OR numerator <= denominator),
    CHECK (NOT is_suppressed OR (numerator IS NULL AND denominator IS NULL))
);
CREATE INDEX regional_health_metrics_lookup_index
    ON regional_health_metrics (region_id, cohort_id, metric_kind, period_end);

CREATE TABLE region_h3_intersections (
    region_id text NOT NULL REFERENCES health_regions,
    h3_cell_id text NOT NULL REFERENCES h3_cells,
    intersection_area_square_meters double precision NOT NULL
        CHECK (intersection_area_square_meters > 0),
    PRIMARY KEY (region_id, h3_cell_id)
);

CREATE TABLE cell_summaries (
    generation_id text NOT NULL,
    h3_cell_id text NOT NULL REFERENCES h3_cells,
    target_date date NOT NULL,
    cohort_id text NOT NULL,
    model_version text NOT NULL,
    component_values jsonb NOT NULL,
    evidence_metadata jsonb NOT NULL,
    PRIMARY KEY (generation_id, h3_cell_id, target_date, cohort_id)
);

-- Use an unexposed schema and RLS as defense in depth.
REVOKE ALL ON SCHEMA ecology FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ecology FROM PUBLIC;
ALTER TABLE source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE h3_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE regional_health_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE region_h3_intersections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cell_summaries ENABLE ROW LEVEL SECURITY;
```

No browser role gets a policy or table grants. The batch owner performs writes. Before deploying FastAPI, create a dedicated select-only login, grant schema usage and SELECT on only the curated tables needed by its queries, and add SELECT policies for that role; verify anonymous/browser roles cannot read them. Do not give the API the database owner's credentials. Secrets and login creation stay outside version control.

Use adapter/Pydantic validation for H3 resolution/validity, finite numeric values, legal source records, required denominators, and region/cohort compatibility. Database checks are a second barrier. The `tick_testing` adapter requires both counts unless suppressed, preserves zero tests as insufficient data, and rejects positives greater than tests. Apply one batch transaction and prune old generations before retaining new summaries.

## 3. Spatial indexing and joins

The first migration uses portable H3 strings and PostGIS; it does not assume Supabase provides the optional H3 PostgreSQL extension. Generate cell IDs and geometries in Python. Use overlapping polygon coverage rather than center-only filling so narrow county fragments are included:

```python
import h3

def candidate_cell_ids(region_geojson: dict, h3_resolution: int) -> list[str]:
    if h3_resolution not in (5, 7):
        raise ValueError("Detailed region coverage requires H3 resolution 5 or 7")
    region_shape = h3.geo_to_h3shape(region_geojson)
    return sorted(h3.h3shape_to_cells_experimental(
        region_shape, h3_resolution, contain="overlap"
    ))

def observation_cell_id(latitude_degrees: float, longitude_degrees: float) -> str:
    return h3.latlng_to_cell(latitude_degrees, longitude_degrees, 5)
```

Pin an h3-py v4 release supporting the documented overlap function and verify it against exact PostGIS intersections. Convert `h3.cell_to_boundary`'s `(lat, lon)` sequence to closed GeoJSON `(lon, lat)` polygons. Split geometries at the antimeridian before planar storage/intersection; test holes, islands, pentagons, and ±180° endpoints. Rendered parent/child coverage is not a substitute for an exact county intersection. [H3 region coverage modes](https://h3geo.org/docs/api/regions/).

Prepare intersections with exact geometry and geodesic area; boundaries may share edges, so area-zero touches are excluded:

```sql
INSERT INTO ecology.region_h3_intersections
    (region_id, h3_cell_id, intersection_area_square_meters)
SELECT regions.region_id, cells.h3_cell_id,
       ST_Area(ST_Intersection(regions.geometry, cells.geometry)::geography)
FROM ecology.health_regions AS regions
JOIN ecology.h3_cells AS cells
  ON regions.geometry && cells.geometry
 AND ST_Intersects(regions.geometry, cells.geometry)
WHERE regions.region_type = 'county'
  AND ST_Area(ST_Intersection(regions.geometry, cells.geometry)::geography) > 0
ON CONFLICT (region_id, h3_cell_id) DO UPDATE
SET intersection_area_square_meters = EXCLUDED.intersection_area_square_meters;
```

Point-to-region queries use `ST_Covers(region.geometry, observation.geometry)` so boundary points are not dropped. If adjacent regions both cover an exact boundary point, choose the lexicographically smallest region ID for count assignment and record `boundary_assignment=true`; never count it twice. Cell assignment is the point's H3 ID. For a cell spanning multiple counties, retain every county fragment in the drawer rather than inventing one exact local prevalence.

Weather joins use a prepared anchor lookup: nearest eligible land anchor within 25,000 m using PostGIS geography distance, stable anchor ID tie-break. Join forecast values by anchor ID, initialization time, and valid hour; never combine hours from different forecast runs silently. Save distance and source grid scale. No in-range anchor means unavailable weather. Population is the sum of pixel population counts multiplied by pixel/cell overlap fractions; intensive raster quantities use valid-area weighted means. Raster NoData is unknown, not zero people/habitat.

## 4. County-to-H3 allocation without false prevalence

For an eligible county testing record `c`, let `positive_c / tested_c = prevalence_c`. This is a sampled cohort's prevalence, not a general population or infection rate. Let `a_ch` be county/cell overlap area, `habitat_h` the habitat suitability, and `reports_h` a count of eligible recent tick records for the same species/stage. Define:

```text
report_support_h = min(1, reports_h / 10)
weight_raw_ch = a_ch × (0.2 + 0.8 × habitat_h) × (1 + report_support_h)
allocation_weight_ch = weight_raw_ch / sum_h(weight_raw_ch)
allocated_positive_ch = positive_c × allocation_weight_ch
allocated_tested_ch = tested_c × allocation_weight_ch
context_prevalence_ch = positive_c / tested_c
```

The area term conserves the county's extensive counts. Habitat and sightings change an explicitly **hypothetical allocation of sampling burden**, not measured prevalence: allocating numerator and denominator with the same weights leaves the ratio unchanged. Retain fractional allocated values and label them modeled, never “ticks tested here.” Keep `context_prevalence` attached to its original county and period. Do not divide a county prevalence rate among cells or multiply it by habitat and call that a measured rate.

The following parameterized SQL returns the exact proposed allocation. `:health_metric_id`, `:knowledge_cutoff`, `:taxon_identifier`, and `:life_stage` are bound parameters, not string interpolation. Historical frames use their recorded knowledge cutoff; all future frames retain the generation cutoff. The target health record must already be eligible at that cutoff; suppressed/categorical/human-case records do not enter this query.

```sql
WITH tick_reports AS (
    SELECT h3_resolution_5_cell_id AS h3_cell_id, count(*) AS report_count
    FROM ecology.observations
    WHERE observation_kind = 'tick' AND public_point_eligible
      AND taxon_identifier = :taxon_identifier AND life_stage = :life_stage
      AND observed_at >= CAST(:knowledge_cutoff AS timestamptz) - interval '7 days'
      AND observed_at < CAST(:knowledge_cutoff AS timestamptz)
      AND retrieved_at <= CAST(:knowledge_cutoff AS timestamptz)
    GROUP BY h3_resolution_5_cell_id
), weighted_fragments AS (
    SELECT health.health_metric_id, health.region_id, cells.h3_cell_id,
           health.numerator, health.denominator,
           intersections.intersection_area_square_meters
             * (0.2 + 0.8 * cells.habitat_suitability)
             * (1 + LEAST(1.0, COALESCE(ticks.report_count, 0) / 10.0)) AS raw_weight
    FROM ecology.regional_health_metrics AS health
    JOIN ecology.region_h3_intersections AS intersections USING (region_id)
    JOIN ecology.h3_cells AS cells USING (h3_cell_id)
    LEFT JOIN tick_reports AS ticks USING (h3_cell_id)
    WHERE health.health_metric_id = :health_metric_id
      AND health.metric_kind = 'tick_testing' AND NOT health.is_suppressed
      AND health.denominator > 0 AND health.numerator IS NOT NULL
      AND cells.h3_resolution = 5 AND cells.habitat_suitability IS NOT NULL
), normalized_fragments AS (
    SELECT *, raw_weight / NULLIF(sum(raw_weight) OVER
        (PARTITION BY health_metric_id), 0) AS allocation_weight
    FROM weighted_fragments
)
SELECT region_id, h3_cell_id, allocation_weight,
       numerator * allocation_weight AS modeled_allocated_positive,
       denominator * allocation_weight AS modeled_allocated_tested,
       numerator / denominator AS county_context_prevalence
FROM normalized_fragments;
```

Only allocate a whole county when the complete county/cell intersection set and habitat inputs are present. If some fragments are missing, refuse full-county allocation; do not renormalize the complete county's counts into a partial pilot viewport. The `COALESCE` above is permitted only after an adapter establishes complete report-query coverage for the seven-day window; otherwise leave the allocation unavailable or use a separately labeled habitat-only allocation version. Preserve the same cutoff for every joined source.

At resolution 7, use the same intersection formula with res-7 sightings, independent exact intersections, and full coverage of the selected county. Do not allocate all a county's counts into only the visible res-7 shard. The first release shows county context on res-7 cells; full res-7 burden allocation is deferred until its coverage/budget gate passes. Do not add res-5 and res-7 allocations together. A change of resolution changes representation, not total county counts.

County categorical presence remains categorical. Human cases stay regional counts/rates and never become tick-test prevalence. Several counties touching a cell retain separate fragment records; no denominator-free average is published as a cell infection rate.

## 5. Versioned experimental risk engine

Model version: `vectorcast-heuristic-v1`. These parameters are planning choices to make a reproducible prototype, not validated ecological constants. The prompt's soil `>7°C` and humidity `>82%` become an explicit example trigger, not a universal biological law. Support one configured species/stage/cohort first. Display all components before the composite.

Let `clip(x) = min(1, max(0, x))`. Reject non-finite values, negative counts, RH outside 0–100%, moisture outside 0–1, and impossible positive/tested counts. Missing dependencies return null with reasons. A proven zero and missing evidence never share the same representation.

### Avian activity and stopover potential

For a known-complete recent-query window, count distinct eligible guild observations in the 72 hours before the frame's knowledge cutoff:

```text
B = clip(log(1 + bird_report_count_72h) / log(21))
R_hour = clip(precipitation_mm_per_hour / 2)
C_hour = clip(low_cloud_cover_percent / 100)
F_hour_weather_proxy = 0.6 × R_hour + 0.4 × C_hour
habitat = clip(tree_fraction + 0.7 × shrub_fraction + 0.3 × grass_fraction)
F_day = max(F_hour over valid nighttime forecast hours)
I = B × F_day × habitat
```

`B` is a **ground-sighting activity proxy** in the default `ground-sightings-v1` avian mode. It is not aerial bird density or counts of tick-carrying birds. Nighttime comes from the provider's `is_day=0`, not a fixed worldwide local clock. If no nighttime hour is represented, `F_day` is unavailable. Habitat is computed from valid land-cover area; no valid raster coverage means null.

With a real measured travel heading, an optional `heading-weather-v1` mode adds headwind:

```text
wind_east = -wind_speed_ms × sin(wind_from_direction_radians)
wind_north = -wind_speed_ms × cos(wind_from_direction_radians)
headwind_ms = max(0, -(wind_east × heading_east + wind_north × heading_north))
H_hour = clip(headwind_ms / 5)
F_hour_heading = 0.4 × R_hour + 0.3 × C_hour + 0.3 × H_hour
```

Heading must be a unit vector from an eligible track/processed radar source and wind altitude must be disclosed/matched. Do not infer a heading by connecting unrelated eBird points. Low cloud cover is a cloudiness proxy, not measured cloud ceiling. A missing heading selects the explicitly named weather-proxy mode; it does not manufacture a zero headwind. A later radar activity mode uses a documented fixed reference distribution and a new model version, rather than silently substituting unlike units into `B`.

### Questing suitability and tick reporting

For each valid hour:

```text
T_hour = min(clip((soil_temperature_c - 7) / 8), clip((35 - soil_temperature_c) / 10))
RH_hour = clip((relative_humidity_percent - 60) / 22)
V_hour = clip((1.2 - vapour_pressure_deficit_kpa) / 1.2)
M_hour = clip(soil_moisture_fraction / 0.3)
Q_hour = T_hour × RH_hour × V_hour × M_hour
example_questing_trigger_hour = soil_temperature_c > 7 AND relative_humidity_percent > 82
Q_day = max(Q_hour), requiring at least 18 valid hours in the UTC day
S = clip(log(1 + eligible_tick_report_count_7d) / log(11))
E = Q_day × (0.5 × S + 0.5 × I)
```

`Q` is weather-model suitability, `S` is reporting intensity, and `I` is inferred stopover potential. None is measured tick population density. All weather variables must come from the same initialization and anchor. An optional NDVI habitat variant can use `habitat × clip((NDVI - 0.1) / 0.6)` only after product QC/coverage is established and with a distinct habitat/model version; the baseline uses WorldCover alone.

### Pathogen context, population, and composite

For an eligible county-fragment testing record of the selected cohort:

```text
p_county = positive_ticks / tested_ticks
P = clip(log(1 + resident_population_count_h3) / log(10001))
community_index_county_fragment = 100 × E × p_county × P
```

Require `tested_ticks >= 20`, at least three eligible tick reports in seven days and three guild bird reports in 72 hours, known habitat/population, a complete report window, current weather, and an eligible health period before publishing this composite. These are conservative prototype input-adequacy gates, not statistical power claims. If a county record is older than three years at frame time, retain its historical drawer context but withhold the composite. Use the latest eligible non-overlapping cohort record; never pool species/stages or average percentages without numerators and denominators.

The result is a 0–100 relative **experimental community index** per county/cell fragment, not a percentage risk. Population uses a dated resident count; it does not establish people outdoors or social vulnerability. Do not sum indices across cells, pathogens, or resolutions. A multi-county cell shows fragment values/original polygons rather than one supposedly measured local prevalence. Demonstration check: `Q=S=I=P=1` and `p_county=0.2` gives index `20`; unknown prevalence gives null.

Input adequacy is reported as the vector `{bird_reports, tick_reports, tested_ticks, weather_valid_hours, weather_anchor_distance_meters, surveillance_period, missing_inputs}`. Do not multiply a confidence score into the index: that could turn poor evidence into an apparently reassuring low value.

### Forecasts and evidence changes

Future weather uses the latest forecast initialized no later than generation time. Bird/tick report counts are fixed at generation's cutoff and explicitly persisted across the seven-day outlook; only weather changes in v1. Future frames therefore describe **conditional suitability**, not predicted birds, new tick populations, new infections, or new pathogen fronts. Days 4–7 are lower-confidence outlooks.

Historical frames use evidence known at their recorded cutoff, never later retrievals or future forecasts. If an old source does not expose historical publication times, label it retrospective context and exclude it from predictive backtesting. Compare identical model versions, cohort, source mode, and coverage before calculating an index delta or evidence-change contour. New cumulative county detection may reflect new surveillance effort, not recent pathogen arrival.

## 6. Static payload and publication contracts

All public objects live below `public/v1/`; private source archives never pass the gateway allowlist. A generation ID is a UTC timestamp such as `20261107T180000Z` plus a short unique suffix when necessary. The manifest pins every object by immutable URL and SHA-256, byte size, schema version, and content encoding.

```json
{
  "schema_version": 1,
  "generation_id": "20261107T180000Z-example",
  "generated_at": "2026-11-07T18:00:00Z",
  "model_version": "vectorcast-heuristic-v1",
  "is_example": true,
  "coverage_region_ids": ["us-county-36083"],
  "available_target_dates": ["2026-11-07", "2026-11-08"],
  "overview": {"path": "public/v1/20261107T180000Z-example/overview.json.gz", "sha256": "<64 hex digits>", "compressed_bytes": 10000},
  "region_frames": [{"region_id": "us-county-36083", "target_date": "2026-11-08", "h3_resolution": 5, "path": "public/v1/20261107T180000Z-example/regions/us-county-36083/2026-11-08.json.gz", "sha256": "<64 hex digits>", "compressed_bytes": 20000}],
  "source_states": [{"source_id": "example-weather", "status": "fresh", "forecast_initialized_at": "2026-11-07T12:00:00Z"}]
}
```

The values above illustrate shape, not a built snapshot or a verified source reading. Manifest validators reject placeholder checksums, missing referenced objects, unsupported schemas, inconsistent generation IDs, future initialization times, and oversized payloads. The first release lists only dates actually available, rather than promising all fifteen date positions contain data.

A region frame has `schema_version`, `generation_id`, `target_date`, `cohort_id`, `h3_resolution`, `source_refs`, and `cells`. Each cell contains its H3 string, report counts, avian mode, stopover/questing values and statuses, original county fragment health context, population baseline, optional community index, adequacy/reason fields, and geometry references. A numeric metric uses this shape:

```json
{
  "value": null,
  "status": "insufficient_data",
  "reason_codes": ["missing_tick_testing_denominator"],
  "source_refs": ["cdc-county-presence"],
  "source_spatial_scale": "county",
  "source_period": {"start": "2025-01-01", "end": "2025-12-31"}
}
```

Counts are integers unless explicitly labeled modeled allocations; JSON numbers must be finite. Public evidence includes only admitted aggregate fields and allowed source links. Global overview res-2/3 values must be recomputed for their stated metric/cohort or shown as coverage/count summaries; never average prevalence or community indices blindly. Region shards are capped at 500 KB compressed each; split by a deterministic H3 parent when larger. Geometry, tracks, health boundaries, and optional PMTiles each have independent versioned references in the manifest; don't repeat full polygons in every daily scalar frame.

## 7. FastAPI specification

FastAPI is optional detail infrastructure. The anonymous landing path reads the manifest and static files only. Shared Pydantic schemas validate Python output; export JSON Schema for the TypeScript runtime boundary. A client keeps one generation ID per view and cancels obsolete date/viewport requests.

| Endpoint | Inputs and output | Limits and behavior |
|---|---|---|
| `GET /healthz` | Process liveness, build version; no database query. | Small public response; never used as a paid-tier keep-alive. |
| `GET /v1/source-status` | Current published source/coverage states and generation ID. | Cached result; static equivalent exists. |
| `GET /v1/region-evidence/{region_id}` | Required `generation_id`, `target_date`, `cohort_id`; returns original regional metrics, time/precision, source links and interpretation. | Region ID allowlist, dates present in manifest, latest DB-backed generation only; historic evidence is linked to its static object. |
| `GET /v1/cell-evidence/{h3_cell_id}` | Same required generation/date/cohort; returns cell components and all intersecting county fragments. | Valid H3 res 5/7, prepared coverage only; bounded source record samples, no private coordinates. |
| `GET /v1/cell-summaries` | Same required generation/date/cohort plus verbose `west_longitude`, `south_latitude`, `east_longitude`, `north_latitude`, `h3_resolution`, and allowlisted `metric_name`. | Longitude span at most 20° and latitude span at most 20°; res 5/7 only, at most 500 returned cells. Split antimeridian windows explicitly. Reject broader queries rather than silently truncating. |

Use descriptive handler signatures, for example `get_cell_evidence(h3_cell_id: str, generation_id: str, target_date: date, cohort_id: str) -> CellEvidence`. `404` means unknown cell/region/generation; `422` means malformed bounds, unsupported metric/date/resolution; `409` means a known generation is no longer queryable dynamically and includes its static alternative; `429` carries `Retry-After`; `503` means optional storage/API is unavailable. Return structured `{error_code, message, generation_id, static_alternative}` without secrets or raw SQL. Cache immutable generation results; errors do not overwrite successful static evidence.

There are no public write endpoints in the pilot. Local saved areas live in browser storage and contain region IDs and the last seen generation. Optional later accounts use Supabase Auth JWT verification, owner-scoped saved-region RLS, and server-side authorization; do not scaffold accounts just to read the map.

## 8. Meaningful verification cases

- Model golden cases: all eligible components at one, 20% testing prevalence → `20`; missing denominator → null; RH exactly 82 and soil exactly 7 do not pass the strict example trigger; no finite/valid temperature/RH/VPD/moisture → explicit error or unavailable component; higher population changes only the contextual index, not prevalence.
- Null/coverage: complete zero-report windows versus failed downloads differ; categorical pathogen presence cannot pass for prevalence; no nighttime hours and fewer than 18 weather hours cannot make a valid daily component.
- Spatial conservation: three county fragments' weights sum to one, allocated positives/tests sum to the original counts within `1e-9` relative tolerance, and every fragment ratio remains county prevalence. Partial coverage refuses full allocation; a two-county cell retains two contexts. Test both resolutions independently.
- Geospatial boundaries: leading-zero FIPS `01001`; county-edge point counted once; polygon hole/island; antimeridian; a pentagon; latitude/longitude reversal; a weather anchor just inside/outside 25 km.
- Time: one frame cannot consume a later forecast initialization, later-known report, stale weather, or a health record outside the model's eligibility window; a model-version/source-mode change suppresses comparisons/alerts.
- Publication/API: unknown license, private fields, NaN, bad checksum, oversize shard, malformed H3, broad bbox, canceled old request, and mismatched generations all have explicit rejection/degradation behavior.

The implementation plan assigns these cases to the tasks that own the relevant behavior. Database and browser runtime verification remain future implementation work; this document does not claim they have passed.
