import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { StateBoundaries } from '../data/mapTypes';
import { buildEcologyMapData } from '../data/ecologyData.ts';
import { tickSuitabilityColorStops } from '../data/suitabilitySurface.ts';
export { tickSuitabilityColorStops } from '../data/suitabilitySurface.ts';

export function createStateHeightExpression(showTickActivity: boolean): ExpressionSpecification | number {
  return showTickActivity ? ['coalesce', ['feature-state', 'display_height'], ['get', 'display_height']] : 45000;
}

export function createStateLabelHeightExpression(showTickActivity: boolean): ExpressionSpecification {
  return ['+', showTickActivity ? ['get', 'display_height'] : 45000, 4000];
}

export function createStateLabelText(): ExpressionSpecification {
  return ['get', 'code'];
}

export function createStateColorExpression(showTickActivity: boolean): ExpressionSpecification {
  return showTickActivity
    ? ['case', ['==', ['feature-state', 'questing_suitability'], null], '#34443b', ['interpolate', ['linear'], ['coalesce', ['feature-state', 'questing_suitability'], 0], ...tickSuitabilityColorStops.flatMap(({ value, color }) => [value, color])]]
    : ['literal', tickSuitabilityColorStops[0].color];
}

export function createMapStyle(stateBoundaries: StateBoundaries, baseUrl = import.meta.env.BASE_URL): StyleSpecification {
  const initialData = buildEcologyMapData(stateBoundaries, null);
  return {
    version: 8,
    projection: { type: 'mercator' },
    light: { anchor: 'viewport', color: '#f4edce', intensity: 0.6, position: [1.15, 220, 40] },
    sources: {
      countries: { type: 'geojson', data: `${baseUrl}data/countries.geojson`, attribution: '<a href="https://www.naturalearthdata.com/">Natural Earth</a>' },
      states: { type: 'geojson', data: initialData.states, promoteId: 'code', attribution: '<a href="https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html">U.S. Census Bureau</a> · <a href="https://open-meteo.com/">Open-Meteo · CC BY 4.0</a> · <a href="https://birdcast.org/data-interpretation/">BirdCast / Cornell</a>' },
      'state-label-points': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'county-label-points': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'geoid' },
      'regional-boundaries': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#142522' } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#293e31' } },
      { id: 'country-borders', type: 'line', source: 'countries', paint: { 'line-color': '#75816a', 'line-opacity': 0.18, 'line-width': 0.7 } },
      { id: 'states', type: 'fill', source: 'states', paint: { 'fill-color': '#465b3f' } },
      { id: 'states-raised', type: 'fill-extrusion', source: 'states', paint: { 'fill-extrusion-color': createStateColorExpression(true), 'fill-extrusion-height': createStateHeightExpression(true), 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } },
      { id: 'surrounding-state-outlines', type: 'line', source: 'states', layout: { visibility: 'none' }, paint: { 'line-color': '#78917c', 'line-opacity': 0.4, 'line-width': 0.75 } },
      { id: 'surrounding-state-names', type: 'symbol', source: 'state-label-points', layout: {
        visibility: 'none', 'text-field': ['get', 'name'], 'text-font': ['Manrope Variable'], 'text-size': 11,
        'text-max-width': 10, 'text-padding': 14, 'symbol-height-offset': 20,
      }, paint: { 'text-color': '#b7c8af', 'text-opacity': 0.75, 'text-halo-color': '#172820', 'text-halo-width': 1.5 } },
      { id: 'selected-state-outline', type: 'line', source: 'states', layout: { visibility: 'none' }, filter: ['==', ['get', 'code'], ''], paint: { 'line-color': '#f0edc9', 'line-opacity': 0.95, 'line-width': 2.2 } },
      { id: 'regional-county-borders', type: 'line', source: 'regional-boundaries', layout: { visibility: 'none' }, filter: ['==', ['get', 'kind'], 'county'], paint: { 'line-color': '#d1d5ad', 'line-width': 1.8, 'line-opacity': 0.65 } },
      { id: 'regional-town-borders', type: 'line', source: 'regional-boundaries', layout: { visibility: 'none' }, minzoom: 4.8, filter: ['!=', ['get', 'kind'], 'county'], paint: { 'line-color': '#a1b8a5', 'line-width': 0.6, 'line-opacity': 0.35 } },
      { id: 'regional-town-names', type: 'symbol', source: 'county-label-points', filter: ['!=', ['get', 'kind'], 'county'], layout: {
        visibility: 'none', 'text-field': ['get', 'name'], 'text-font': ['Manrope Variable'], 'text-size': 11, 'text-max-width': 9, 'text-padding': 10,
        'text-allow-overlap': false, 'text-ignore-placement': false, 'symbol-height-offset': 20,
      }, paint: { 'text-color': '#cbd9be', 'text-opacity': 0.8, 'text-halo-color': '#203629', 'text-halo-width': 1 } },
      { id: 'state-labels', type: 'symbol', source: 'state-label-points', minzoom: 1.2, layout: {
        'text-field': ['get', 'code'], 'text-font': ['Manrope Variable'], 'text-size': 10,
        'text-offset': ['match', ['get', 'code'], 'MD', ['literal', [0, -0.9]], 'DC', ['literal', [0, 0.9]], ['literal', [0, 0]]],
        'text-line-height': 1.4, 'text-padding': 4, 'text-max-width': 12, 'symbol-height-offset': createStateLabelHeightExpression(true),
        'text-allow-overlap': true, 'text-ignore-placement': true,
        'symbol-sort-key': ['match', ['get', 'code'], 'MD', 0, 'DC', 1, 2],
      }, paint: { 'text-color': '#f4f5df', 'text-opacity': 0.95, 'text-halo-color': '#203629', 'text-halo-width': 1.5 } },
      { id: 'state-risk-labels', type: 'symbol', source: 'state-label-points', minzoom: 3.9,
        filter: ['!=', ['get', 'suitability_percent'], null], layout: {
          'text-field': ['concat', ['to-string', ['get', 'suitability_percent']], ' index'], 'text-font': ['Manrope Variable'],
          'text-size': 10, 'text-offset': [0, 1.5], 'text-padding': 8, 'symbol-height-offset': createStateLabelHeightExpression(true),
        }, paint: { 'text-color': '#f4f5df', 'text-opacity': ['interpolate', ['linear'], ['zoom'], 3.9, 0, 4.7, 0.95, 5.4, 0.95, 6.4, 0], 'text-halo-color': '#203629', 'text-halo-width': 1.5 } },
      { id: 'county-labels', type: 'symbol', source: 'county-label-points', filter: ['==', ['get', 'kind'], 'county'], layout: {
        visibility: 'none', 'text-field': ['get', 'name'], 'text-font': ['Manrope Variable'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 14, 14, 18],
        'text-anchor': 'bottom', 'text-offset': [0, 0.5], 'text-line-height': 1.25,
        'text-padding': 4, 'text-max-width': 24, 'symbol-height-offset': 20,
        'text-allow-overlap': false, 'text-ignore-placement': false,
      }, paint: { 'text-color': '#f4f5df', 'text-opacity': 0.95, 'text-halo-color': '#203629', 'text-halo-width': 1.5 } },
    ],
  };
}
