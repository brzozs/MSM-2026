import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRegionalPreview, getStateBounds, getUnitedStatesPanBounds, stateContainsCoordinate } from './regionFocus.ts';
import type { StateFeature } from './regionFocus.ts';
import type { StateBoundaries } from './mapTypes';

const states: StateBoundaries = JSON.parse(readFileSync(new URL('../../public/data/states.geojson', import.meta.url), 'utf8'));

test('state bounds wrap Alaska at the antimeridian rather than fitting most of the world', () => {
  for (const state of states.features) {
    const [[west, south], [east, north]] = getStateBounds(state);
    assert.ok(east > west && east - west < 80);
    assert.ok(north > south && north - south < 40);
  }
});

test('pan bounds retain all 51 state/DC extents with a 25 percent margin and one shared longitude copy', () => {
  const [[west, south], [east, north]] = getUnitedStatesPanBounds(states);
  const stateExtents = states.features.map(getStateBounds);
  const minimumLongitude = Math.min(...stateExtents.map((extent) => extent[0][0]));
  const maximumLongitude = Math.max(...stateExtents.map((extent) => extent[1][0]));
  assert.ok(west < minimumLongitude && east > maximumLongitude);
  assert.ok(Math.abs((minimumLongitude - west) / (maximumLongitude - minimumLongitude) - 0.25) < 1e-8);
  assert.ok(Math.abs((east - maximumLongitude) / (maximumLongitude - minimumLongitude) - 0.25) < 1e-8);
  assert.ok(east - west < 200, 'The allowed view does not wrap around the whole world.');
  assert.ok(south >= -85.051129 && north <= 85.051129);
  for (const [[stateWest, stateSouth], [stateEast, stateNorth]] of stateExtents) {
    assert.ok(stateWest >= west && stateEast <= east && stateSouth >= south && stateNorth <= north);
  }
  const alaskaBounds = getStateBounds(states.features.find((state) => state.properties.code === 'AK')!);
  assert.ok(alaskaBounds[1][0] < 0, 'Alaska and the contiguous U.S. use the same antimeridian-safe world copy.');
});

test('Alaska and Hawaii have changing regional heatmap fixtures and real county/city detail', () => {
  for (const code of ['AK', 'HI']) {
    const state = states.features.find((feature) => feature.properties.code === code)!;
    const first = buildRegionalPreview(state, 3);
    const next = buildRegionalPreview(state, 4);
    assert.ok(first.hotspots.features.some((point) => point.properties.intensity > 0.05));
    assert.notDeepEqual(first.hotspots, next.hotspots);
    const geography = JSON.parse(readFileSync(new URL(`../../public/data/regions/${state.properties.fips}.geojson`, import.meta.url), 'utf8'));
    assert.ok(geography.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'county'));
    assert.ok(geography.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'place'));
  }
});

test('regional containment preserves polygon holes and antimeridian crossings', () => {
  const state: StateFeature = { type: 'Feature', properties: { code: 'EX', name: 'Example', fips: '00', center: [180, 1] },
    geometry: { type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]],
      [[179.5, 0.5], [-179.5, 0.5], [-179.5, 1.5], [179.5, 1.5], [179.5, 0.5]]] } };
  assert.equal(stateContainsCoordinate(state, [179.2, 1]), true);
  assert.equal(stateContainsCoordinate(state, [-179.2, 1]), true);
  assert.equal(stateContainsCoordinate(state, [180, 1]), false);
  assert.equal(stateContainsCoordinate(state, [0, 1]), false);
});

test('state drilldowns use changing synthetic heatmap points inside the actual selected boundary', () => {
  for (const code of ['NY', 'TX', 'CA', 'AK', 'HI', 'DC']) {
    const state = states.features.find((feature) => feature.properties.code === code)!;
    const original = structuredClone(state);
    const preview = buildRegionalPreview(state, 3);
    assert.ok(preview.hotspots.features.length > 0, `${code} has regional sample activity.`);
    assert.deepEqual(state, original);
    for (const point of preview.hotspots.features) {
      assert.equal(point.properties.is_example, true);
      assert.ok(point.properties.intensity >= 0 && point.properties.intensity <= 1);
      assert.ok(stateContainsCoordinate(state, point.geometry.coordinates, preview.bounds));
      assert.equal(point.properties.display_height, 20);
    }
    assert.notDeepEqual(preview.hotspots, buildRegionalPreview(state, 4).hotspots);
    assert.ok(preview.migrationRoute);
    assert.ok(preview.migrationRoute[2][1] > preview.migrationRoute[0][1]);
  }
});

test('regional geography includes real county and town/place names for every selectable state', () => {
  for (const state of states.features) {
    const geography = JSON.parse(readFileSync(new URL(`../../public/data/regions/${state.properties.fips}.geojson`, import.meta.url), 'utf8'));
    assert.equal(geography.type, 'FeatureCollection');
    assert.ok(geography.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'county'));
  }
  const newYork = JSON.parse(readFileSync(new URL('../../public/data/regions/36.geojson', import.meta.url), 'utf8'));
  assert.equal(newYork.features.filter((feature: { properties: { kind: string } }) => feature.properties.kind === 'county').length, 62);
  assert.ok(newYork.features.some((feature: { properties: { name: string; kind: string } }) => feature.properties.name === 'Colonie' && feature.properties.kind === 'town'));
  assert.ok(newYork.features.some((feature: { properties: { name: string; kind: string } }) => feature.properties.name === 'Colonie' && feature.properties.kind === 'place'));
});
