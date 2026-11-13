import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { birdsPerFlock, buildDemoFrame, buildStateActivityFrame, createTimelineDays, flocksPerRoute, getBirdFeatures, getMigrationRoutePosition, migrationRouteCount, type MigrationRoute } from './mapFrames.ts';
import type { StateBoundaries } from './mapTypes';

test('timeline stays on UTC calendar days across the daylight-saving boundary', () => {
  const days = createTimelineDays(new Date('2026-11-01T02:00:00Z'));
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-10-29');
  assert.equal(days[3].date, '2026-11-01');
  assert.equal(days[6].date, '2026-11-04');
  assert.equal(days[3].isToday, true);
});

test('changing the preview day changes the illustrative overlay without mutating earlier frames', () => {
  const firstFrame = buildDemoFrame(0);
  const originalFrame = structuredClone(firstFrame);
  const laterFrame = buildDemoFrame(4);
  assert.notDeepEqual(firstFrame.observations, laterFrame.observations);
  assert.deepEqual(firstFrame, originalFrame);
  for (const feature of laterFrame.observations.features) {
    assert.equal(feature.properties.is_example, true);
    assert.ok(feature.properties.intensity >= 0 && feature.properties.intensity <= 1);
  }
});

test('invalid preview days are rejected rather than selecting an unrelated frame', () => {
  const emptyBoundaries: StateBoundaries = { type: 'FeatureCollection', features: [] };
  for (const invalidDay of [-1, 7, 1.5, Number.NaN]) {
    assert.throws(() => buildDemoFrame(invalidDay), RangeError);
    assert.throws(() => buildStateActivityFrame(emptyBoundaries, invalidDay), RangeError);
  }
});

test('state activity preserves every real boundary and marks bounded, changing values as synthetic', () => {
  const boundaries: StateBoundaries = JSON.parse(readFileSync(new URL('../../public/data/states.geojson', import.meta.url), 'utf8'));
  const originalBoundaries = structuredClone(boundaries);
  const firstFrame = buildStateActivityFrame(boundaries, 0);
  const originalFrame = structuredClone(firstFrame);
  const laterFrame = buildStateActivityFrame(boundaries, 4);
  assert.equal(firstFrame.features.length, 51);
  assert.notDeepEqual(firstFrame, laterFrame);
  assert.deepEqual(boundaries, originalBoundaries);
  assert.deepEqual(firstFrame, originalFrame);
  firstFrame.features.forEach((state, stateIndex) => {
    assert.deepEqual(state.geometry, boundaries.features[stateIndex].geometry);
    assert.equal(state.properties.code, boundaries.features[stateIndex].properties.code);
    assert.equal(state.properties.fips, boundaries.features[stateIndex].properties.fips);
  });
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const activityFrame = buildStateActivityFrame(boundaries, dayIndex);
    for (const state of activityFrame.features) {
      assert.equal(state.properties.is_example, true);
      assert.ok(Number.isFinite(state.properties.sample_tick_activity));
      assert.ok(state.properties.sample_tick_activity >= 0 && state.properties.sample_tick_activity <= 1);
    }
    const newYork = activityFrame.features.find((state) => state.properties.code === 'NY')!;
    const alaska = activityFrame.features.find((state) => state.properties.code === 'AK')!;
    assert.ok(newYork.properties.sample_tick_activity > alaska.properties.sample_tick_activity, 'Activity near the synthetic hotspots exceeds distant sample activity.');
  }
});

test('illustrative bird markers move along bounded routes with finite bearings', () => {
  const startingBirds = getBirdFeatures(0);
  const laterBirds = getBirdFeatures(12);
  assert.equal(startingBirds.features.length, migrationRouteCount * flocksPerRoute * birdsPerFlock);
  assert.notDeepEqual(startingBirds, laterBirds);
  for (const feature of laterBirds.features) {
    const [longitude, latitude] = feature.geometry.coordinates;
    assert.ok(longitude >= -180 && longitude <= 180);
    assert.ok(latitude >= -85 && latitude <= 85);
    assert.ok(Number.isFinite(feature.properties.bearing));
    assert.equal(feature.properties.is_example, true);
  }
});

test('migration paths pass through their departure, stopovers and destination instead of treating stopovers as control points', () => {
  const route: MigrationRoute = [[-120, 40, 480000], [-100, 30, 560000], [-80, 40, 560000], [-60, 30, 480000]];
  for (const [waypointIndex, waypoint] of route.entries()) {
    assert.deepEqual(getMigrationRoutePosition(0, waypointIndex / 3, [route]), waypoint);
  }
  const southeastBird = getBirdFeatures(5, [route]).features[0];
  const northeastBird = getBirdFeatures(23, [route]).features[0];
  assert.ok(southeastBird.properties.bearing > 90 && southeastBird.properties.bearing < 180);
  assert.ok(northeastBird.properties.bearing > 0 && northeastBird.properties.bearing < 90);
});

test('flocks turn smoothly at migration waypoints', () => {
  const route: MigrationRoute = [[-120, 40, 480000], [-100, 30, 560000], [-80, 40, 560000], [-60, 30, 480000]];
  const before = getBirdFeatures((1 / 3 - 0.00001) / 0.022, [route]).features[0];
  const after = getBirdFeatures((1 / 3 + 0.00001) / 0.022, [route]).features[0];
  assert.ok(Math.abs(before.properties.bearing - after.properties.bearing) < 0.1);
  assert.ok(Math.abs(before.geometry.coordinates[0] - after.geometry.coordinates[0]) < 0.01);
});

test('each pathway carries three northbound flocks with shared leaders and compact V formations', () => {
  const birds = getBirdFeatures(5).features;
  for (let routeIndex = 0; routeIndex < migrationRouteCount; routeIndex += 1) {
    const routeBirds = birds.filter((bird) => bird.properties.route_id === routeIndex);
    assert.equal(routeBirds.length, flocksPerRoute * birdsPerFlock);
    for (let flockIndex = 0; flockIndex < flocksPerRoute; flockIndex += 1) {
      const flock = routeBirds.filter((bird) => bird.properties.flock_id === flockIndex);
      assert.equal(flock.length, 7);
      assert.equal(flock.filter((bird) => bird.properties.flock_rank === 0).length, 1);
      for (const bird of flock) {
        assert.equal(bird.properties.route_progress, flock[0].properties.route_progress);
        assert.deepEqual(bird.geometry.coordinates, flock[0].geometry.coordinates);
        assert.ok(Math.abs(bird.properties.bearing) < 90);
      }
      for (const rank of [1, 2, 3]) {
        assert.deepEqual(flock.filter((bird) => bird.properties.flock_rank === rank).map((bird) => bird.properties.flock_side).sort((first, second) => first - second), [-rank, rank]);
      }
    }
  }
});
