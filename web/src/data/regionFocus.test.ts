import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRegionalPreview, getStateBounds, stateContainsCoordinate } from './regionFocus.ts';
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
