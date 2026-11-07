# Map geography

- `countries.geojson`: Natural Earth Admin 0 Countries, 1:110m, version 5.1.1. Downloaded November 7, 2026 from https://naturalearth.s3.amazonaws.com/110m_cultural/ne_110m_admin_0_countries.zip. Public domain; terms: https://www.naturalearthdata.com/about/terms-of-use/. Retains only country name/code and geometry. Boundaries follow the provider's cartographic conventions.
- `states.geojson`: U.S. Census Bureau 2024 cartographic state boundaries, 1:20m. Downloaded November 7, 2026 from https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_20m.zip. Federal public-domain geography; includes 50 states and DC, with name, postal code, FIPS, approximate view center and geometry. Territories are excluded from this first preview.
- `us-states-preview.svg`: static fallback rendered from those Census boundaries for the contiguous states and DC; no data or model is encoded in the colors.

ZIP shapefiles were converted to GeoJSON with pyshp; source geometry was preserved. Shape labels and the Manrope UI font render locally.

Activity points, route geometry, bird positions and day-to-day variation in `src/data/mapFrames.ts` are synthetic UI fixtures, not observed birds/ticks, weather or health data. State height is a fixed visual treatment and does not represent a metric.
