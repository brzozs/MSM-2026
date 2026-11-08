import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStateActivityFrame } from './mapFrames.ts';
import { buildRegionalLabelSource, buildTickRiskLabels } from './tickRiskLabels.ts';
import type { CountyLabelPoints } from './tickRiskLabels';
import type { StateBoundaries } from './mapTypes';
import { stateContainsCoordinate } from './regionFocus.ts';

const states: StateBoundaries = JSON.parse(readFileSync(new URL('../../public/data/states.geojson', import.meta.url), 'utf8'));
const counties: CountyLabelPoints = JSON.parse(readFileSync(new URL('../../public/data/county-labels.geojson', import.meta.url), 'utf8'));

test('county label index covers every real Census county without duplicate geographic identifiers', () => {
  assert.equal(counties.features.length, 3144);
  assert.equal(new Set(counties.features.map((county) => county.properties.geoid)).size, 3144);
  for (const state of states.features) {
    const regionalGeography = JSON.parse(readFileSync(new URL(`../../public/data/regions/${state.properties.fips}.geojson`, import.meta.url), 'utf8'));
    const actualCounties = regionalGeography.features.filter((feature: { properties: { kind: string } }) => feature.properties.kind === 'county');
    const labelPoints = counties.features.filter((county) => county.properties.state_fips === state.properties.fips);
    assert.deepEqual(labelPoints.map((county) => county.properties.geoid).sort(), actualCounties.map((county: { properties: { geoid: string } }) => county.properties.geoid).sort());
    assert.ok(labelPoints.every((county) => county.geometry.coordinates.every(Number.isFinite)));
    for (const label of labelPoints) {
      const actualCounty = actualCounties.find((county: { properties: { geoid: string } }) => county.properties.geoid === label.properties.geoid);
      assert.ok(stateContainsCoordinate({ ...state, geometry: actualCounty.geometry }, label.geometry.coordinates), `${label.properties.name} label stays inside its real county boundary.`);
    }
  }
});

test('state and county percentages are bounded daily sample indices and stay above their containing state roofs', () => {
  const originalCounties = structuredClone(counties);
  const frame = buildStateActivityFrame(states, 3);
  const originalFrame = structuredClone(frame);
  const labels = buildTickRiskLabels(frame, counties, 3, null);
  assert.equal(labels.states.features.length, 51);
  assert.equal(labels.counties.features.length, 3144);
  labels.states.features.forEach((label, index) => {
    assert.equal(label.properties.sample_risk_percent, Math.round(frame.features[index].properties.sample_tick_activity * 100));
    assert.equal(label.properties.display_height, frame.features[index].properties.display_height + 4000);
  });
  labels.counties.features.forEach((label, index) => {
    const state = frame.features.find((feature) => feature.properties.fips === counties.features[index].properties.state_fips)!;
    assert.equal(label.properties.display_height, state.properties.display_height + 4000);
  });
  for (const label of [...labels.states.features, ...labels.counties.features]) {
    assert.ok(Number.isInteger(label.properties.sample_risk_percent));
    assert.ok(label.properties.sample_risk_percent >= 0 && label.properties.sample_risk_percent <= 100);
    assert.equal(label.properties.is_example, true);
    assert.ok(label.properties.name.length > 0);
  }
  assert.deepEqual(frame, originalFrame);
  assert.deepEqual(counties, originalCounties);
  assert.notDeepEqual(labels.counties, buildTickRiskLabels(buildStateActivityFrame(states, 4), counties, 4, null).counties);
});

test('state focus keeps county percentages consistent while moving labels to the regional surface', () => {
  const frame = buildStateActivityFrame(states, 3);
  const national = buildTickRiskLabels(frame, counties, 3, null);
  const regional = buildTickRiskLabels(frame, counties, 3, 'NY');
  assert.equal(regional.states.features.length, 51, 'Surrounding states retain their labels in the regional view.');
  assert.equal(regional.counties.features.length, 62);
  const nationwidePercentages = new Map(national.counties.features.map((county) => [county.properties.geoid, county.properties.sample_risk_percent]));
  for (const label of regional.counties.features) {
    assert.equal(label.properties.display_height, 20);
    assert.equal(label.properties.sample_risk_percent, nationwidePercentages.get(label.properties.geoid));
  }
  assert.throws(() => buildTickRiskLabels(frame, { type: 'FeatureCollection', features: [{ ...counties.features[0], properties: { ...counties.features[0].properties, state_fips: '99' } }] }, 3, null), /no matching state/);
});

test('every state retains its real counties and city/place geometry in the shared label source', () => {
  const frame = buildStateActivityFrame(states, 3);
  for (const state of states.features) {
    const geography = JSON.parse(readFileSync(new URL(`../../public/data/regions/${state.properties.fips}.geojson`, import.meta.url), 'utf8'));
    const geographyIdentifiers = new Set<string>();
    for (const feature of geography.features) {
      assert.ok(feature.properties.geoid.startsWith(state.properties.fips), `${state.properties.code}: FIPS identifies the correct state.`);
      assert.ok(feature.properties.name.length > 0);
      assert.ok(!geographyIdentifiers.has(feature.properties.geoid), `${state.properties.code}: geography identifiers are unique.`);
      geographyIdentifiers.add(feature.properties.geoid);
      assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
    }
    const cities = geography.features.filter((feature: { properties: { kind: string } }) => feature.properties.kind !== 'county');
    assert.ok(cities.length > 0, `${state.properties.code} has city/place geography.`);
    const labels = buildTickRiskLabels(frame, counties, 3, state.properties.code);
    const sharedSource = buildRegionalLabelSource(labels.counties, geography);
    assert.deepEqual(sharedSource.features.filter((feature) => feature.properties?.kind !== 'county'), cities, 'City boundaries and names are preserved exactly.');
    assert.equal(sharedSource.features.filter((feature) => feature.properties?.kind === 'county').length, labels.counties.features.length);
  }
});
