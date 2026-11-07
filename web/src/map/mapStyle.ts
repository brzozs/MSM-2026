import type { StyleSpecification } from 'maplibre-gl';
import type { StateBoundaries } from '../data/mapTypes';
import { buildDemoFrame, getBirdFeatures } from '../data/mapFrames';

export function createMapStyle(stateBoundaries: StateBoundaries): StyleSpecification {
  const initialFrame = buildDemoFrame(3);
  return {
    version: 8,
    light: { anchor: 'viewport', color: '#f4edce', intensity: 0.45, position: [1.15, 220, 40] },
    sources: {
      countries: { type: 'geojson', data: '/data/countries.geojson', attribution: '<a href="https://www.naturalearthdata.com/">Natural Earth</a>' },
      states: { type: 'geojson', data: stateBoundaries, attribution: '<a href="https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html">U.S. Census Bureau</a>' },
      'state-centers': { type: 'geojson', data: { type: 'FeatureCollection', features: stateBoundaries.features.map((state) => ({ type: 'Feature', properties: state.properties, geometry: { type: 'Point', coordinates: state.properties.center } })) } },
      'sample-activity': { type: 'geojson', data: initialFrame.observations },
      'sample-routes': { type: 'geojson', data: initialFrame.routes },
      'sample-birds': { type: 'geojson', data: getBirdFeatures(0, 3) },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#142522' } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#293e31' } },
      { id: 'country-borders', type: 'line', source: 'countries', paint: { 'line-color': '#75816a', 'line-opacity': 0.18, 'line-width': 0.7 } },
      { id: 'states', type: 'fill', source: 'states', paint: { 'fill-color': '#465b3f' } },
      { id: 'states-raised', type: 'fill-extrusion', source: 'states', paint: { 'fill-extrusion-color': '#465b3f', 'fill-extrusion-height': 16000, 'fill-extrusion-opacity': 0.96, 'fill-extrusion-vertical-gradient': true } },
      { id: 'state-outlines', type: 'line', source: 'states', paint: { 'line-color': '#a5ae88', 'line-opacity': 0.28, 'line-width': 0.7 } },
      { id: 'tick-heatmap', type: 'heatmap', source: 'sample-activity', paint: {
        'heatmap-weight': ['get', 'intensity'], 'heatmap-intensity': 1.3,
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 27, 7, 42], 'heatmap-opacity': 0.72,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(232,182,110,0)', 0.2, 'rgba(207,151,69,0.16)', 0.5, 'rgba(231,160,68,0.52)', 0.8, 'rgba(244,196,106,0.8)', 1, 'rgba(255,227,160,0.98)'],
      } },
      { id: 'migration-glow', type: 'line', source: 'sample-routes', paint: { 'line-color': '#d2e2b7', 'line-width': 7, 'line-opacity': 0.04, 'line-blur': 4 } },
      { id: 'migration-routes', type: 'line', source: 'sample-routes', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#c6d9a6', 'line-width': 1.1, 'line-opacity': 0.5, 'line-dasharray': [2, 4] } },
      { id: 'pathogen-context', type: 'line', source: 'states', filter: ['in', ['get', 'code'], ['literal', ['NY', 'PA', 'MA', 'CT', 'WI', 'MN']]], layout: { visibility: 'none' }, paint: { 'line-color': '#c3a6a1', 'line-width': 2, 'line-opacity': 0.8 } },
      { id: 'state-labels', type: 'symbol', source: 'state-centers', minzoom: 2.6, layout: { 'text-field': ['get', 'code'], 'text-font': ['Manrope Variable'], 'text-size': 10, 'text-letter-spacing': 0.12, 'text-padding': 14 }, paint: { 'text-color': '#d6dbc5', 'text-opacity': 0.7, 'text-halo-color': '#293e31', 'text-halo-width': 1 } },
    ],
  };
}
