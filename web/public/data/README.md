# Map geography

- `countries.geojson`: Natural Earth Admin 0 Countries, 1:110m, version 5.1.1. Downloaded November 7, 2026 from https://naturalearth.s3.amazonaws.com/110m_cultural/ne_110m_admin_0_countries.zip. Public domain; terms: https://www.naturalearthdata.com/about/terms-of-use/. Retains only country name/code and geometry. Boundaries follow the provider's cartographic conventions.
- `states.geojson`: U.S. Census Bureau 2024 cartographic state boundaries, 1:20m. Downloaded November 7, 2026 from https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_20m.zip. Federal public-domain geography; includes 50 states and DC, with name, postal code, FIPS, approximate view center and geometry. Territories are excluded from this first preview.
- `us-states-preview.svg`: static fallback rendered from those Census boundaries for the contiguous states and DC; no data or model is encoded in the colors.

ZIP shapefiles were converted to GeoJSON with pyshp; source geometry was preserved. Shape labels and the Manrope UI font render locally.

- `regions/<state FIPS>.geojson`: Census 2024 cartographic county, place, and county-subdivision boundaries at 1:500,000. Downloaded November 7, 2026 from `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_{county,place,cousub}_500k.zip`. Contains 3,144 counties/equivalents, 32,041 incorporated/Census-designated places, and 21,288 subdivisions named town/township across the 50 states and DC. Statistical county divisions are excluded from the town supplement. Census place boundaries include CDPs and are not all municipal jurisdictions. Names and GEOIDs are retained; coordinates are rounded to five decimal places. Each state's file loads on demand. Source: https://www.census.gov/geographies/mapping-files/2024/geo/carto-boundary-file.html. Federal public-domain geography.

`web/scripts/prepare_regional_geography.py` reproduces the regional files using the authoring-only `pyshp` package; the browser needs no additional package or remote geography API.

Activity points, flock movement, wind trails and day-to-day variation are synthetic UI fixtures, not observed birds/ticks, measured wind, weather forecasts or health data. National state height and brightness visualize sample activity with exaggerated display altitude. Heatmap glows use the same state-height field and stay just above each roof. The state drilldown uses continuous sample heatmap glows over real county/town/place geometry; it publishes no county or town health measurements.
