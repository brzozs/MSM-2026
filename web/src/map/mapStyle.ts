import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { StateBoundaries } from '../data/mapTypes';
import { baseStateHeightMeters, buildDemoFrame, buildStateActivityFrame } from '../data/mapFrames';
import { buildElevatedActivity } from '../data/activityGlow';
import { buildTickRiskLabels } from '../data/tickRiskLabels';

export const stateLabelOpacity: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5.4, 0.95, 6.4, 0];
export const stateRiskLabelOpacity: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 3.9, 0, 4.7, 0.95, 5.4, 0.95, 6.4, 0];
export const countyLabelOpacity: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5.4, 0, 6.4, 0.95];

export function createStateHeightExpression(showTickActivity: boolean): ExpressionSpecification | number {
  return showTickActivity ? ['get', 'display_height'] : baseStateHeightMeters;
}

export function createStateColorExpression(showTickActivity: boolean, showCommunityExposure: boolean): ExpressionSpecification {
  const colors = showCommunityExposure ? ['#c5edce', '#96c6ad', '#648f7e', '#365b54'] : ['#d9eba3', '#a5c56e', '#6e8b51', '#42573c'];
  return showTickActivity
    ? ['interpolate', ['linear'], ['get', 'sample_tick_activity'], 0, colors[0], 0.35, colors[1], 0.7, colors[2], 1, colors[3]]
    : ['literal', showCommunityExposure ? '#365b54' : '#42573c'];
}

export function createMapStyle(stateBoundaries: StateBoundaries): StyleSpecification {
  const initialFrame = buildDemoFrame(3);
  const stateActivity = buildStateActivityFrame(stateBoundaries, 3);
  const initialLabels = buildTickRiskLabels(stateActivity, { type: 'FeatureCollection', features: [] }, 3, null);
  return {
    version: 8,
    projection: { type: 'mercator' },
    light: { anchor: 'viewport', color: '#f4edce', intensity: 0.6, position: [1.15, 220, 40] },
    sources: {
      countries: { type: 'geojson', data: '/data/countries.geojson', attribution: '<a href="https://www.naturalearthdata.com/">Natural Earth</a>' },
      states: { type: 'geojson', data: stateActivity, attribution: '<a href="https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html">U.S. Census Bureau</a>' },
      'sample-activity': { type: 'geojson', data: buildElevatedActivity(stateActivity, initialFrame.observations) },
      'regional-boundaries': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'state-label-points': { type: 'geojson', data: initialLabels.states },
      'county-label-points': { type: 'geojson', data: initialLabels.counties },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#142522' } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#293e31' } },
      { id: 'country-borders', type: 'line', source: 'countries', paint: { 'line-color': '#75816a', 'line-opacity': 0.18, 'line-width': 0.7 } },
      { id: 'states', type: 'fill', source: 'states', paint: { 'fill-color': '#465b3f' } },
      { id: 'states-raised', type: 'fill-extrusion', source: 'states', paint: { 'fill-extrusion-color': createStateColorExpression(true, false), 'fill-extrusion-height': createStateHeightExpression(true), 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } },
      { id: 'state-outlines', type: 'line', source: 'states', layout: { visibility: 'none' }, paint: { 'line-color': '#a5ae88', 'line-opacity': 0.12, 'line-width': 0.7 } },
      { id: 'selected-state-outline', type: 'line', source: 'states', filter: ['==', ['get', 'code'], ''], paint: { 'line-color': '#f0edc9', 'line-opacity': 0.95, 'line-width': 2.2 } },
      { id: 'tick-activity-glow', type: 'symbol', source: 'sample-activity', layout: {
        visibility: 'none',
        'icon-image': 'activity-glow', 'icon-size': 0.95, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-pitch-alignment': 'map', 'icon-rotation-alignment': 'map', 'symbol-height-offset': ['get', 'display_height'],
      }, paint: { 'icon-opacity': ['interpolate', ['linear'], ['get', 'intensity'], 0, 0.08, 1, 0.75] } },
      { id: 'regional-county-borders', type: 'line', source: 'regional-boundaries', filter: ['==', ['get', 'kind'], 'county'], paint: { 'line-color': '#d1d5ad', 'line-width': 1, 'line-opacity': 0.55 } },
      { id: 'regional-town-borders', type: 'line', source: 'regional-boundaries', minzoom: 4.8, filter: ['!=', ['get', 'kind'], 'county'], paint: { 'line-color': '#a1b8a5', 'line-width': 0.65, 'line-opacity': 0.35 } },
      { id: 'regional-county-names', type: 'symbol', source: 'regional-boundaries', filter: ['==', ['get', 'kind'], 'county'], layout: {
        'text-field': ['get', 'name'], 'text-font': ['Manrope Variable'], 'text-size': 11, 'text-max-width': 9, 'text-padding': 15,
      }, paint: { 'text-color': '#e4e7cd', 'text-halo-color': '#203629', 'text-halo-width': 1.5 } },
      { id: 'regional-town-names', type: 'symbol', source: 'regional-boundaries', minzoom: 6, filter: ['!=', ['get', 'kind'], 'county'], layout: {
        'text-field': ['get', 'name'], 'text-font': ['Manrope Variable'], 'text-size': 9, 'text-max-width': 8, 'text-padding': 9,
      }, paint: { 'text-color': '#cbd9be', 'text-halo-color': '#203629', 'text-halo-width': 1 } },
      { id: 'pathogen-context', type: 'line', source: 'states', filter: ['in', ['get', 'code'], ['literal', ['NY', 'PA', 'MA', 'CT', 'WI', 'MN']]], layout: { visibility: 'none' }, paint: { 'line-color': '#c3a6a1', 'line-width': 2, 'line-opacity': 0.8 } },
      { id: 'state-labels', type: 'symbol', source: 'state-label-points', minzoom: 1.2, layout: {
        'text-field': ['get', 'name'], 'text-font': ['Manrope Variable'], 'text-size': 10,
        'text-line-height': 1.4, 'text-padding': 8, 'text-max-width': 12, 'symbol-height-offset': ['get', 'display_height'],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      }, paint: { 'text-color': '#f4f5df', 'text-opacity': 0.95, 'text-halo-color': '#203629', 'text-halo-width': 1.5 } },
      { id: 'state-risk-labels', type: 'symbol', source: 'state-label-points', minzoom: 3.9, layout: {
        'text-field': ['concat', ['to-string', ['get', 'sample_risk_percent']], '% sample risk'],
        'text-font': ['Manrope Variable'], 'text-size': 10, 'text-offset': [0, 1.5],
        'text-padding': 8, 'text-max-width': 14, 'symbol-height-offset': ['get', 'display_height'],
      }, paint: { 'text-color': '#f4f5df', 'text-opacity': stateRiskLabelOpacity, 'text-halo-color': '#203629', 'text-halo-width': 1.5 } },
      { id: 'county-risk-labels', type: 'symbol', source: 'county-label-points', minzoom: 5.4, layout: {
        'text-field': ['get', 'label_with_risk'], 'text-font': ['Manrope Variable'], 'text-size': 10,
        'text-line-height': 1.35, 'text-padding': 8, 'text-max-width': 12, 'symbol-height-offset': ['get', 'display_height'],
        'symbol-sort-key': ['-', 100, ['get', 'sample_risk_percent']],
      }, paint: { 'text-color': '#f4f5df', 'text-opacity': countyLabelOpacity, 'text-halo-color': '#203629', 'text-halo-width': 1.5 } },
    ],
  };
}
