# Connected bird and tick evidence — experimental U.S. model

VectorCast retains two primary layers and the existing illustrative animation. The map's tick colors, heights and local surface show a **0–100 relative questing-weather index**, never percent risk. The focal questing cohort is **Ixodes scapularis nymphs**. The independent bird-mediated deposition scenario concerns **fed I. scapularis larvae and nymphs**. A deposited larva must molt and mature; a deposited nymph develops toward an adult. Neither becomes an additional questing nymph tomorrow.

## What is observed, forecast and inferred

| Input or output | Meaning and limits |
| --- | --- |
| eBird bird reports | Admitted sightings of selected ground-foraging species. Counts mean report records, not numbers of birds, measured abundance, complete surveys, routes or tick carriage. Local observation dates and source links are retained. Partial capped queries and missing sampling effort stay explicit. |
| iNaturalist tick reports | Licensed, public, unobscured, precision-filtered presence reports. All eligible tick taxa are shown as evidence; inconsistent life stages prevent using these as I. scapularis nymph counts. No reports does not mean absence. |
| BirdCast radar | Processed nocturnal airborne density within the existing 150 km support limit. Actual observed night, source radar, distance and profile count are retained. It does not identify species, stopover, tick carriage, destination or detachment. |
| Open-Meteo | Existing hourly soil/weather forecasts, with the original source retrieval time, daily peak factors and minimum 18 valid-hour gate. Weather source age does not reset when radar/habitat is attached. |
| USGS Annual NLCD | Classified satellite land cover, pinned to **2025**, 30 m source pixels, CONUS. This is a measured land-cover class, not field-verified habitat or current litter conditions. One pixel at an existing weather reference nearest each CONUS state/DC grid centroid is queried (at most 49 requests). Other grid points remain missing. No regional area fractions, interpolation or 50 km habitat claim. |
| Stopover potential | Experimental inference combining the radar passage proxy, forecast grounding-weather proxy and an explicit land-cover class weight at sampled references only. It is not measured landing density. |
| Deposition potential | A conditional relative scenario assuming suitable birds already carry immature ticks. Its lower/central/upper values are a scenario envelope and mean, not confidence intervals, measured tick counts or probabilities. |
| Post-drop survival and development | Withheld. Ambient forecasts and one land-cover pixel do not measure leaf-litter microclimate or calibrate survival of fed ticks. Field development/diapause and later questing cohorts are not predicted. |

Source windows remain fixed across future forecast dates. The initial snapshot has 1,131 state-assigned bird records from 1,153 eligible query records, with 22 outside the bundled land geometry, and three eligible tick records. State counts are geographic subsets; they never overwrite national query provenance. Original query metadata are preserved on repeated publication. These are historical snapshot counts, not a promise about future collections.

## Scope and geography

The nationwide interface and weather evidence remain available. The supported model envelope is an explicit engineering approximation for the eastern CONUS: longitude 100°W–66°W, latitude 24–50°N, excluding Alaska/Hawaii. The envelope follows the broad [CDC eastern distribution of I. scapularis](https://www.cdc.gov/ticks/about/where-ticks-live.html); it is **not a range polygon or evidence of local establishment**, and model validation is absent even within it. Western I. pacificus, other tick species, adults and bird-specific infestation prevalence are not modeled. Species-specific index display is withheld outside this scope while raw weather remains inspectable.

Missing radar, habitat or nighttime weather withholds dependent stopover/deposition values and leaves available components intact. Zero is a real result under the chosen scenario; null means unavailable. The original complete-cohort report/habitat gates in `activity_components` remain unchanged. This new conditional scenario does not turn partial report counts into abundance or unlock that gated composite.

## Biological evidence and explicit assumptions

[Hamer et al. (2012)](https://wwwnc.cdc.gov/eid/article/18/10/12-0511_article) documented immature I. scapularis on U.S. birds, along with other tick species and strongly variable carriage. No infestation percentage is transferred into this nationwide model.

[Heylen et al. (2020)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7225381/) measured feeding on house finches: larval means 3.56–4.68 days and nymphal means 4.39–5.11 days across experiments, with most detachments during daylight. These are host-specific laboratory means, not universal bounds. The model's **3, 4, 5 and 6 day total-feeding scenarios** are analyst-selected sensitivity assumptions informed by that study. Unknown attachment age is assumed uniform, and the four durations are equally weighted. This is not a fitted detachment probability. Daily granularity does not model time of day; no precise drop-off location is inferred.

[Kocan et al. (2015)](https://doi.org/10.1186/s13071-015-1185-7) reported approximately 28 days for fed larvae to molt, followed by approximately 14 days of maturation under rearing conditions. Field temperature and diapause alter development; these lab intervals are not a universal emergence date. Fed nymphs progress toward adults. VectorCast deliberately adds **no deposited cohort to current 1–7 day questing**.

[Stafford (1994)](https://academic.oup.com/jme/article-abstract/31/2/310/2221387) demonstrated humidity- and stage-dependent survival in **unfed** ticks at constant laboratory temperature. Those results cannot calibrate outdoor survival of fed deposited ticks from daily ambient humidity. The persistence/survival output is null, rather than an invented factor. [Ginsberg et al. (2020)](https://www.usgs.gov/publications/local-abundance-ixodes-scapularis-forests-effects-environmental-moisture-vegetation) supports attention to forest cover/moisture, without establishing the class weights below.

[Guo et al. (2023)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9934294/) estimated stopover using specialized departure scans and extensive quality control. VectorCast uses generic overnight passage, which **does not implement that measured stopover method**. [Cornell/BirdCast](https://birdcast.org/faq/) explains that passing birds need not stop and radar cannot resolve species. Rain/cloud forecasts here only represent a hypothetical grounding modifier, not observed fallout or a wind/flight trajectory model.

## Small, inspectable calculation

For each admitted weather reference and forecast day:

- `migration_pressure = min(1, log1p(airborne_birds_per_square_km) / log(101))`. The normalization is an uncalibrated scale, not a proportion of birds carrying ticks.
- The existing `stopover_weather_proxy` is the valid-night maximum of `0.6*clip(rain_mm/2) + 0.4*low_cloud_fraction`. `stopover_weather_factor = 0.5 + 0.5*proxy`; the arbitrary fair-weather floor allows stopover in clear conditions. Neither coefficient is biologically calibrated.
- Land-cover class weights are an explicit woodland/ground-use scenario: forest 41/42/43 and woody wetland 90 → 1; shrub 52 → 0.5; herbaceous wetland 95 → 0.25; grass/pasture 71/81 → 0.1; other admitted classes → 0. A zero class weight means zero **under this chosen woodland scenario**, not that birds/ticks cannot occur there. Missing/invalid classes are null, never zero.
- `stopover_index = migration_pressure * stopover_weather_factor * habitat_factor`, only within the supported envelope and with all three inputs. The same measured night is held across dates as a scenario input, not forecast migration.
- If the forecast is `a` days after the measured night, the modeled interval is `[max(0,a−1), max(0,a−1)+1]`. For each feeding duration `d` in 3/4/5/6, `detachment_weight = length(interval ∩ [0,d]) / d`. This follows the uniform-unknown-age assumption. Lower/central/upper are the minimum/mean/maximum of those four values.
- `deposition_potential = stopover_index * detachment_weight`, reported as a **conditional relative index**, independently of survival. The observed cohort's scenario contribution ends after the six-day residual window. It does not represent newly arriving unobserved cohorts or tracking birds between cells. This is an illustrative scenario at weather reference locations, not a prediction of release points.
- `post_drop_persistence_index = null`; `contributes_to_current_questing = false`. Current questing uses source weather alone; the previous blanket radar boost is removed. No pathogens, disease/exposure probabilities or population inputs enter these calculations.

Values can change across dates because forecasts change, supported samples differ, and the assumed residual attachment window declines. The weather/radar/land-cover observation dates do not advance with the forecast date. Counts remain the same retrieved evidence, never forecasts.

## Operations and reproducibility

`python3 -m pipeline.measured_migration` attaches admitted radar evidence, fetches/reuses the bounded static-vintage NLCD reference cache, calculates connected components, then republishes the existing atlas. `python3 -m pipeline.publish` publishes only manifest-referenced public JSON. `npm --prefix web run prepare:data` runs both stages. No raw radar CSVs or collection caches become public. Existing 25 km weather-provider coordinate admission and report eligibility gates remain intact. Habitat is attached only at the exact sampled reference; no spatial fallback.

NLCD uses the official [USGS/MRLC service directory](https://www.mrlc.gov/data-services-page), [2025 vintage documentation](https://www.usgs.gov/centers/eros/science/about-annual-nlcd), and [class legend](https://www.mrlc.gov/data/legends/annual-nlcd-land-cover-legend). WMS 1.1.1 `GetFeatureInfo` uses EPSG:4326, the pinned time dimension and JSON `PALETTE_INDEX`; unexpected/no-data classes or service failures are unavailable and not cached. Valid cached pixels retain their original retrieval timestamp. There is no key, paid account or automatic hosted activation.

The local verification generation reuses the original weather, bird/tick and November 7 radar evidence. Only the bounded USGS habitat lookup is newly collected. Weather is stale; it is not relabeled freshly retrieved. The original saved pre-radar generation was matched by observation records and source retrieval times to recover the already-corrupted query counts before republishing.
